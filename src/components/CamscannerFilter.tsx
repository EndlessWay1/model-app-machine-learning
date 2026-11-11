/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import cvModule from "@techstark/opencv-js";

export type FilterMode =
  | "original"
  | "magic"
  | "magic_gray"
  | "grayscale"
  | "bw";
interface CamScannerFilterProps {
  image: string;
  onApply: (blob: Blob) => void;
}

/* ---------- OpenCV loader (works with old and new builds) ---------- */

/* ---------- OpenCV loader ---------- */
let cvPromise: Promise<{ cv: any }> | null = null;

function loadCv(): Promise<{ cv: any }> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    const mod: any = cvModule;
    const candidates: any[] = [mod];
    const isReady = (c: any) => !!c && typeof c.Mat === "function";

    // The package may be a thenable that resolves to the real instance
    if (typeof mod?.then === "function") {
      mod.then((resolved: any) => {
        if (resolved) candidates.push(resolved);
      });
    }

    // Older builds signal readiness through this callback
    try {
      mod.onRuntimeInitialized = () => candidates.push(mod);
    } catch {
      /* read-only, ignore */
    }

    const started = Date.now();
    const timer = setInterval(() => {
      const ready = candidates.find(isReady);
      if (ready) {
        clearInterval(timer);
        resolve({ cv: ready }); // wrapped so the Promise doesn't unwrap it
      } else if (Date.now() - started > 30000) {
        clearInterval(timer);
        cvPromise = null;
        reject(new Error("OpenCV failed to initialize within 30s"));
      }
    }, 50);
  });

  return cvPromise;
}

/* ---------- Helpers ---------- */

// Replacement for cv.imread: canvas -> RGBA Mat
function readMat(cv: any, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mat = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4);
  mat.data.set(data.data);
  return mat;
}

// Replacement for cv.imshow: Mat (1, 3 or 4 channels) -> canvas
function showMat(cv: any, mat: any, canvas: HTMLCanvasElement) {
  const rgba = new cv.Mat();
  const channels = mat.channels();

  if (channels === 1) cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
  else if (channels === 3) cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
  else mat.copyTo(rgba);

  canvas.width = rgba.cols;
  canvas.height = rgba.rows;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows),
      0,
      0,
    );

  rgba.delete();
}

// Estimate the paper background of a single 8-bit channel and divide it out.
// This removes shadows / uneven lighting and turns the paper white.
function normalizeChannel(cv: any, channel: any): any {
  const scale = Math.min(1, 600 / Math.max(channel.cols, channel.rows));
  const small = new cv.Mat();
  const bgSmall = new cv.Mat();
  const bg = new cv.Mat();
  const out = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));

  cv.resize(
    channel,
    small,
    new cv.Size(
      Math.round(channel.cols * scale),
      Math.round(channel.rows * scale),
    ),
    0,
    0,
    cv.INTER_AREA,
  );

  cv.dilate(small, bgSmall, kernel); // erase dark text/ink
  cv.medianBlur(bgSmall, bgSmall, 21); // smooth lighting estimate
  cv.resize(
    bgSmall,
    bg,
    new cv.Size(channel.cols, channel.rows),
    0,
    0,
    cv.INTER_LINEAR,
  );

  cv.divide(channel, bg, out, 255, -1);

  small.delete();
  bgSmall.delete();
  bg.delete();
  kernel.delete();
  return out;
}

function unsharp(cv: any, mat: any, amount = 0.6) {
  const blur = new cv.Mat();
  cv.GaussianBlur(mat, blur, new cv.Size(0, 0), 2);
  cv.addWeighted(mat, 1 + amount, blur, -amount, 0, mat);
  blur.delete();
}

/* ---------- Component ---------- */

export default function CamScannerFilter({
  image,
  onApply,
}: CamScannerFilterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);

  const [cvReady, setCvReady] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const [mode, setMode] = useState<FilterMode>("magic_gray");
  const [contrast, setContrast] = useState(1.25);
  const [threshold, setThreshold] = useState(185);
  const cvRef = useRef<any>(null); // <-- add this

  // Load OpenCV
  useEffect(() => {
    let alive = true;
    loadCv()
      .then(({ cv }) => {
        if (!alive) return;
        cvRef.current = cv;
        setCvReady(true);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  // Load image into an offscreen source canvas
  useEffect(() => {
    if (!image) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgReady(false);
    const img = new Image();
    img.onload = () => {
      const src = document.createElement("canvas");
      src.width = img.naturalWidth;
      src.height = img.naturalHeight;
      src.getContext("2d")!.drawImage(img, 0, 0);
      sourceRef.current = src;
      setImgReady(true);
    };
    img.onerror = () => console.error("Failed to load filter image:", image);
    img.src = image;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [image]);

  // Run the filter
  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    const cv = cvRef.current; // <-- not cvModule

    if (!cvReady || !imgReady || !canvas || !source || !cv) return;

    const mats: any[] = [];
    const track = <T,>(m: T): T => {
      mats.push(m);
      return m;
    };

    try {
      const src = track(readMat(cv, source));
      const rgb = track(new cv.Mat());
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

      let result: any;

      if (mode === "original") {
        result = rgb;
      } else if (mode === "magic" || mode === "magic_gray") {
        // Color: normalize each channel, then boost contrast and sharpen
        const channels = track(new cv.MatVector());
        cv.split(rgb, channels);

        const normalized = track(new cv.MatVector());
        for (let i = 0; i < 3; i++) {
          const ch = channels.get(i);
          normalized.push_back(normalizeChannel(cv, ch));
          ch.delete();
        }

        const merged = track(new cv.Mat());
        cv.merge(normalized, merged);

        const boosted = track(new cv.Mat());
        merged.convertTo(boosted, -1, contrast, -(contrast - 1) * 110);
        unsharp(cv, boosted, 0.6);

        if (mode === "magic_gray") {
          const gray = track(new cv.Mat());
          cv.cvtColor(boosted, gray, cv.COLOR_RGB2GRAY);
          result = gray;
        } else {
          result = boosted;
        }
      } else {
        // Grayscale-based modes
        const gray = track(new cv.Mat());
        cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
        const norm = track(normalizeChannel(cv, gray));

        if (mode === "grayscale") {
          const boosted = track(new cv.Mat());
          norm.convertTo(boosted, -1, contrast, -(contrast - 1) * 110);
          unsharp(cv, boosted, 0.6);
          result = boosted;
        } else {
          // bw: crisp black & white
          const bw = track(new cv.Mat());
          cv.threshold(norm, bw, threshold, 255, cv.THRESH_BINARY);
          result = bw;
        }
      }

      showMat(cv, result, canvas);
    } catch (err) {
      console.error("OpenCV filter failed:", err);
    } finally {
      mats.forEach((m) => {
        try {
          m.delete();
        } catch {
          /* already freed */
        }
      });
    }
  }, [cvReady, imgReady, mode, contrast, threshold]);

  function applyFilter() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => blob && onApply(blob), "image/jpeg", 0.95);
  }

  return (
    <div className='scanner-filter'>
      <h2>Image Filter Preview</h2>

      {!cvReady && <p>Loading image engine…</p>}

      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "auto" }}
      />

      <div className='filter-controls'>
        <label>Filter</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as FilterMode)}
        >
          <option value='original'>Original</option>
          <option value='magic'>Magic Color</option>
          <option value='grayscale'>Grayscale</option>
          <option value='bw'>Black & White</option>
          <option value='magic_gray'>Scan → Grayscale</option>
        </select>

        {(mode === "magic" ||
          mode === "magic_gray" ||
          mode === "grayscale") && (
          <>
            <label>Contrast: {contrast.toFixed(2)}</label>
            <input
              type='range'
              min='1'
              max='2'
              step='0.05'
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
            />
          </>
        )}

        {mode === "bw" && (
          <>
            <label>Threshold: {threshold}</label>
            <input
              type='range'
              min='100'
              max='240'
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </>
        )}

        <button onClick={applyFilter} disabled={!cvReady}>
          Apply Filter
        </button>
      </div>
    </div>
  );
}

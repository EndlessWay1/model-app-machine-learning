import { useRef, useState, type PointerEvent } from "react";
import "./ImageCropper.css";

interface ImageCropperProps {
  image: string;
  onCrop: (blob: Blob) => void;
  onCancel?: () => void;
}

type Pt = { x: number; y: number }; // fractions 0..1 of the image
const MAX_OUT = 2048;
const INSET: Pt[] = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
]; // TL, TR, BR, BL
const LABELS = ["TL", "TR", "BR", "BL"];

const dist = (a: Pt, b: Pt, w: number, h: number) =>
  Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

// Solve 8x8 system -> homography mapping dst rect corners to src quad
function homography(dst: Pt[], src: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]).concat(1);
}

// Perspective-warp the quad into a straight rectangle
function warp(img: HTMLImageElement, q: Pt[], square: boolean): Promise<Blob> {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  const s = document.createElement("canvas");
  s.width = nw;
  s.height = nh;
  const sctx = s.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);
  const src = sctx.getImageData(0, 0, nw, nh).data;

  let W = Math.max(dist(q[0], q[1], nw, nh), dist(q[3], q[2], nw, nh));
  let H = Math.max(dist(q[0], q[3], nw, nh), dist(q[1], q[2], nw, nh));
  if (square) W = H = Math.max(W, H);
  const k = Math.min(1, MAX_OUT / Math.max(W, H));
  W = Math.max(2, Math.round(W * k));
  H = Math.max(2, Math.round(H * k));

  const m = homography(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    q.map((p) => ({ x: p.x * nw, y: p.y * nh })),
  );

  const out = new ImageData(W, H);
  const d = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const z = m[6] * x + m[7] * y + 1;
      const u = (m[0] * x + m[1] * y + m[2]) / z;
      const v = (m[3] * x + m[4] * y + m[5]) / z;
      const x0 = Math.min(nw - 2, Math.max(0, Math.floor(u)));
      const y0 = Math.min(nh - 2, Math.max(0, Math.floor(v)));
      const fx = Math.min(1, Math.max(0, u - x0));
      const fy = Math.min(1, Math.max(0, v - y0));
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * nw + x0) * 4 + c];
        const b = src[(y0 * nw + x0 + 1) * 4 + c];
        const e = src[((y0 + 1) * nw + x0) * 4 + c];
        const f = src[((y0 + 1) * nw + x0 + 1) * 4 + c];
        d[i + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy;
      }
      d[i + 3] = 255;
    }
  }

  const o = document.createElement("canvas");
  o.width = W;
  o.height = H;
  o.getContext("2d")!.putImageData(out, 0, 0);
  return new Promise((res, rej) =>
    o.toBlob((b) => (b ? res(b) : rej(new Error("Export failed"))), "image/jpeg", 0.95),
  );
}

export default function ImageCropper({ image, onCrop, onCancel }: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [pts, setPts] = useState<Pt[]>(INSET);
  const [drag, setDrag] = useState<number | null>(null);
  const [square, setSquare] = useState(false);
  const [loading, setLoading] = useState(false);

  function move(e: PointerEvent) {
    if (drag === null || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setPts((p) => p.map((pt, i) => (i === drag ? { x, y } : pt)));
  }

  async function apply() {
    if (!imgRef.current) return;
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the UI show "Straightening..."
      onCrop(await warp(imgRef.current, pts, square));
    } catch (err) {
      console.error("Crop failed:", err);
    } finally {
      setLoading(false);
    }
  }

  const poly = pts.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");

  return (
    <section className='image-cropper'>
      <h2>Adjust Corners</h2>
      <p className='crop-hint'>Drag the 4 corners to match the object. It will be straightened automatically.</p>

      <div className='crop-stage' onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <img ref={imgRef} src={image} alt='Crop preview' draggable={false} />

        <svg viewBox='0 0 100 100' preserveAspectRatio='none'>
          <path d={`M0,0H100V100H0Z M${poly.replace(/ /g, "L")}Z`} fillRule='evenodd' className='crop-mask' />
          <polygon points={poly} className='crop-poly' />
        </svg>

        {pts.map((p, i) => (
          <div
            key={LABELS[i]}
            className={`crop-handle ${drag === i ? "active" : ""}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(i);
            }}
          />
        ))}
      </div>

      <div className='crop-options'>
        <label>
          <input type='checkbox' checked={square} onChange={(e) => setSquare(e.target.checked)} />
          Force 1:1 square
        </label>
        <button type='button' onClick={() => setPts(INSET)}>Reset</button>
        <button
          type='button'
          onClick={() => setPts([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])}
        >
          Full image
        </button>
      </div>

      <div className='crop-actions'>
        {onCancel && (
          <button type='button' onClick={onCancel} disabled={loading}>Cancel</button>
        )}
        <button type='button' className='crop-apply' onClick={apply} disabled={loading}>
          {loading ? "Straightening..." : "Apply & Straighten"}
        </button>
      </div>
    </section>
  );
}
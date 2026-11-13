import { useEffect, useRef, useState, type DragEvent } from "react";
import "./camera.css";

interface CameraProps {
  onCapture: (image: Blob) => void;
  facingMode?: "user" | "environment";
}

const MAX_SIDE = 2560;
const ACCEPT =
  "image/*,.png,.jpg,.jpeg,.jfif,.webp,.gif,.bmp,.avif,.tif,.tiff,.svg,.ico,.heic,.heif";

// Decode any browser-supported image into a bitmap/element
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Fallback (e.g. SVG, some GIF/ICO): use <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

// Convert any image file to a normalized JPEG blob
async function fileToJpeg(file: File): Promise<Blob> {
  const src = await decode(file);
  const w0 = (src as HTMLImageElement).naturalWidth || src.width || 1024;
  const h0 = (src as HTMLImageElement).naturalHeight || src.height || 1024;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w0 * scale));
  canvas.height = Math.max(1, Math.round(h0 * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = "#fff"; // transparent PNG/WebP/SVG -> white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if ("close" in src) (src as ImageBitmap).close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      "image/jpeg",
      0.95,
    ),
  );
}

export default function Camera({
  onCapture,
  facingMode = "environment",
}: CameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"upload" | "camera">("upload");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }

  async function startCamera() {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera unavailable");
    }
  }

  function captureImage() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((b) => b && onCapture(b), "image/jpeg", 0.95);
  }

  async function handleFile(file?: File | null) {
    if (!file) return;
    setError(null);

    if (file.type && !file.type.startsWith("image/") && !/\.(heic|heif|tiff?)$/i.test(file.name)) {
      setError("File is not an image.");
      return;
    }

    setBusy(true);
    try {
      onCapture(await fileToJpeg(file));
    } catch {
      setError(
        "This image format can't be decoded by your browser (e.g. HEIC outside Safari). Please convert it to JPG/PNG.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  function switchMode(next: "upload" | "camera") {
    if (next === "upload") stopCamera();
    setMode(next);
  }

  useEffect(() => () => stopCamera(), []);

  return (
    <div className='camera'>
      <div className='source-tabs'>
        <button
          type='button'
          className={mode === "upload" ? "on" : ""}
          onClick={() => switchMode("upload")}
        >
          ⇪ Upload file
        </button>
        <button
          type='button'
          className={mode === "camera" ? "on" : ""}
          onClick={() => switchMode("camera")}
        >
          ◉ Camera
        </button>
      </div>

      {mode === "upload" && (
        <div
          className={`dropzone ${dragging ? "drag" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          role='button'
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        >
          <div className='drop-icon'>⇪</div>
          <strong>{busy ? "Processing image..." : "Drop image here or click to browse"}</strong>
          <span>PNG · JPG · WEBP · GIF · BMP · AVIF · SVG · HEIC (Safari)</span>
          <input
            ref={fileRef}
            type='file'
            accept={ACCEPT}
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {mode === "camera" && (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className='camera-preview'
          />
          <div className='camera-controls'>
            {!active ? (
              <button type='button' onClick={startCamera}>
                Start Camera
              </button>
            ) : (
              <>
                <button type='button' onClick={captureImage}>
                  Capture
                </button>
                <button type='button' className='ghost' onClick={stopCamera}>
                  Stop Camera
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error && <p className='error'>{error}</p>}
    </div>
  );
}
import { useEffect, useRef, useState } from "react";

export type FilterMode = "original" | "grayscale" | "document";

interface CamScannerFilterProps {
  image: string;
  onApply: (blob: Blob) => void;
}

export default function CamScannerFilter({
  image,
  onApply,
}: CamScannerFilterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<FilterMode>("grayscale");
  const [contrast, setContrast] = useState(1.3);
  const [threshold, setThreshold] = useState(150);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      ctx.drawImage(img, 0, 0);

      if (mode === "original") return;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const pixels = imageData.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const gray =
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];

        let value = gray;

        if (mode === "document") {
          value = (gray - 128) * contrast + 128;
          value = value >= threshold ? 255 : 0;
        }

        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
      }

      ctx.putImageData(imageData, 0, 0);
    };

    img.onerror = () => {
      console.error("Failed to load filter image:", image);
    };

    img.src = image;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [image, mode, contrast, threshold]);

  function applyFilter() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onApply(blob);
        }
      },
      "image/jpeg",
      0.95,
    );
  }

  return (
    <div className='scanner-filter'>
      <h2>Image Filter Preview</h2>

      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
        }}
      />

      <div className='filter-controls'>
        <label>Filter</label>

        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as FilterMode)}
        >
          <option value='original'>Original</option>
          <option value='grayscale'>Grayscale</option>
          <option value='document'>Document Scanner</option>
        </select>

        {mode === "document" && (
          <>
            <label>Contrast: {contrast.toFixed(1)}</label>

            <input
              type='range'
              min='0.5'
              max='3'
              step='0.1'
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
            />

            <label>Threshold: {threshold}</label>

            <input
              type='range'
              min='0'
              max='255'
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </>
        )}

        <button onClick={applyFilter}>Apply Filter</button>
      </div>
    </div>
  );
}

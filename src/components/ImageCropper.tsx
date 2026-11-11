import { useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";

import "react-image-crop/dist/ReactCrop.css";
import "./ImageCropper.css";

interface ImageCropperProps {
  image: string;
  onCrop: (blob: Blob) => void;
  onCancel?: () => void;
}

function centerInitialCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 80,
      },
      width / height,
      width,
      height,
    ),
    width,
    height,
  );
}

async function getCroppedImage(
  image: HTMLImageElement,
  crop: PixelCrop,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  canvas.width = Math.round(crop.width * scaleX);
  canvas.height = Math.round(crop.height * scaleY);

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export cropped image"));
      },
      "image/jpeg",
      0.95,
    );
  });
}

export default function ImageCropper({
  image,
  onCrop,
  onCancel,
}: ImageCropperProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  const [crop, setCrop] = useState<Crop>({
    unit: "%",
    x: 10,
    y: 10,
    width: 80,
    height: 80,
  });

  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();

  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;

    setCrop(centerInitialCrop(img.width, img.height));
  }

  async function handleCrop() {
    if (!imageRef.current || !completedCrop) return;

    try {
      setLoading(true);

      const blob = await getCroppedImage(imageRef.current, completedCrop);

      onCrop(blob);
    } catch (error) {
      console.error("Crop failed:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className='image-cropper'>
      <h2>Crop Image</h2>

      <div className='crop-workspace'>
        <ReactCrop
          crop={crop}
          onChange={(_, percentCrop) => setCrop(percentCrop)}
          onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
          keepSelection
          minWidth={20}
          minHeight={20}
        >
          <img
            ref={imageRef}
            src={image}
            alt='Crop preview'
            onLoad={handleImageLoad}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "500px",
              width: "auto",
              height: "auto",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
            }}
          />
        </ReactCrop>
      </div>

      <div className='crop-controls'>
        <label>Zoom: {zoom.toFixed(1)}x</label>

        <input
          type='range'
          min='1'
          max='3'
          step='0.1'
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </div>

      <div className='crop-actions'>
        {onCancel && (
          <button type='button' onClick={onCancel} disabled={loading}>
            Cancel
          </button>
        )}

        <button
          type='button'
          onClick={handleCrop}
          disabled={loading || !completedCrop?.width}
        >
          {loading ? "Cropping..." : "Apply Crop"}
        </button>
      </div>
    </section>
  );
}

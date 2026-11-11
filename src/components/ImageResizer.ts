interface ResizeOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "image/jpeg" | "image/png";
  fit?: "cover" | "contain";
}

export async function resizeImage(
  image: Blob,
  options: ResizeOptions = {},
): Promise<Blob> {
  const {
    width = 224,
    height = 224,
    quality = 0.95,
    format = "image/jpeg",
    fit = "cover",
  } = options;

  const bitmap = await createImageBitmap(image);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas context unavailable");
  }

  const scale =
    fit === "cover"
      ? Math.max(width / bitmap.width, height / bitmap.height)
      : Math.min(width / bitmap.width, height / bitmap.height);

  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;

  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(bitmap, x, y, drawWidth, drawHeight);

  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image resizing failed"));
      },
      format,
      quality,
    );
  });
}

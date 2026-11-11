import { useEffect, useRef, useState } from "react";

interface CameraProps {
  onCapture: (image: Blob) => void;
  facingMode?: "user" | "environment";
}

export default function Camera({
  onCapture,
  facingMode = "environment",
}: CameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  async function startCamera() {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setActive(false);
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

    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      "image/jpeg",
      0.95,
    );
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className='camera'>
      {error && <p className='error'>{error}</p>}

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className='camera-preview'
      />

      <div className='camera-controls'>
        {!active ? (
          <button onClick={startCamera}>Start Camera</button>
        ) : (
          <>
            <button onClick={captureImage}>Capture</button>

            <button onClick={stopCamera}>Stop Camera</button>
          </>
        )}
      </div>
    </div>
  );
}

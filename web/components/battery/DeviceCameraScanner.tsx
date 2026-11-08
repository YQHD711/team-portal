"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

interface Props {
  onScan: (raw: string) => void;
  disabled?: boolean;
}

/** 浏览器摄像头扫码（BarcodeDetector）；不支持时给出替代方案提示。 */
export function DeviceCameraScanner({ onScan, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stop, []);

  const start = async () => {
    if (typeof window === "undefined") return;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持内置扫码，请用扫码枪输入编码");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      setError(null);
      const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          if (found.length > 0) {
            const raw = found[0].rawValue;
            stop();
            onScan(raw);
            return;
          }
        } catch {
          // 单帧失败继续下一帧
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setError("无法打开摄像头，请检查权限");
      stop();
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={() => (scanning ? stop() : start())}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
      >
        {scanning ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        {scanning ? "停止摄像头" : "摄像头扫码"}
      </button>
      {scanning && (
        <video ref={videoRef} muted playsInline className="w-full max-w-sm rounded-lg border border-border bg-black" />
      )}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

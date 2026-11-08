"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Camera, CameraOff, Keyboard, Loader2, ScanLine } from "lucide-react";
import { BatteryCard } from "@/components/battery/BatteryCard";
import { type BatteryItem } from "@/components/battery/batteryTypes";

/** BarcodeDetector 的最小类型声明（浏览器原生扫码 API，TS lib 里还没有）。 */
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/** 从扫码内容里取电池编码：支持纯编码、短链 /b/<code> 或 /i/<code>。 */
export function extractBatteryCode(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p === "b" || p === "i");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  } catch {
    // 不是 URL，按纯编码处理
  }
  return trimmed;
}

export default function BatteryScanPage() {
  const [code, setCode] = useState("");
  const [battery, setBattery] = useState<BatteryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stopCamera, []);

  const lookup = async (raw: string) => {
    const normalized = extractBatteryCode(raw);
    if (!normalized) return;
    setBusy(true);
    setError(null);
    setBattery(null);
    try {
      setBattery(await api.get<BatteryItem>(`/api/battery/by-code/${encodeURIComponent(normalized)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "没有找到这块电池");
    } finally {
      setBusy(false);
    }
  };

  const act = async (kind: "borrow" | "return") => {
    if (!battery) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/battery/${battery.id}/${kind}`, {});
      setBattery(await api.get<BatteryItem>(`/api/battery/by-code/${encodeURIComponent(battery.code)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const startCamera = async () => {
    const errorText = "当前浏览器不支持内置扫码，请用手机相机扫描电池二维码，或直接用扫码枪输入编码";
    if (typeof window === "undefined") return;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError(errorText);
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
            stopCamera();
            setCode(extractBatteryCode(raw));
            await lookup(raw);
            return;
          }
        } catch {
          // 单帧识别失败继续下一帧
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setError("无法打开摄像头，请检查权限，或改用扫码枪/手输");
      stopCamera();
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">扫码借还</h1>
        <p className="text-sm text-muted">扫码枪直接扫、手输编码回车，或用本页摄像头识别二维码</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") lookup(code); }}
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm font-mono"
              placeholder="扫电池二维码 / 输入编码后回车"
            />
          </div>
          <button onClick={() => lookup(code)} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}查询
          </button>
          <button onClick={() => scanning ? stopCamera() : startCamera()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
            {scanning ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
            {scanning ? "停止" : "摄像头"}
          </button>
        </div>

        {scanning && (
          <video ref={videoRef} muted playsInline
            className="w-full max-w-sm rounded-lg border border-border bg-black" />
        )}

        {error && <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      </div>

      {battery && (
        <BatteryCard
          battery={battery}
          busy={busy}
          onBorrow={() => act("borrow")}
          onReturn={() => act("return")}
        />
      )}

      <div className="text-center text-xs text-faint">
        <Link href="/batteries" className="underline">返回电池台账</Link>
        <span className="mx-2">·</span>
        手机可直接用相机扫电池标签二维码打开借还页
      </div>
    </div>
  );
}

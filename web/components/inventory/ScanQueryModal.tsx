"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import jsQR from "jsqr";
import { Camera, CameraOff, Loader2, PackageSearch, Search, X } from "lucide-react";
import type { InventoryItem } from "./inventoryTypes";
import { cameraUnavailableReason, canUseCamera, extractCodeFromScan } from "@/lib/scan";

interface Props {
  onClose: () => void;
  /** 查到之后回调（用于跳转或刷新列表） */
  onFound?: (item: InventoryItem) => void;
}

/**
 * 二维码查询：扫码 / 输码 / 扫码枪，三种方式查出这是哪件物料。
 *
 * 摄像头那条路只在安全上下文可用（见 lib/scan.ts），不可用时直接说明原因。
 * 手输与扫码枪走的是同一个输入框——USB 扫码枪本质上就是"打字 + 回车"。
 */
export default function ScanQueryModal({ onClose, onFound }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [camera, setCamera] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setCamera(canUseCamera()); }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const lookup = useCallback(async (raw: string) => {
    const target = extractCodeFromScan(raw);
    if (!target) { setError("请输入或扫描物料编码"); return; }
    setCode(target); setBusy(true); setError(""); setItem(null);
    try {
      const found = await api.get<InventoryItem>(`/api/inventory/by-code/${encodeURIComponent(target)}`);
      setItem(found);
      onFound?.(found);
    } catch {
      setError(`没有找到编码 ${target} 对应的物料。可能标签印错了，或这件还没录进系统。`);
    } finally { setBusy(false); }
  }, [onFound]);

  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(scanLoop); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width) { rafRef.current = requestAnimationFrame(scanLoop); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (found?.data) { stopCamera(); void lookup(found.data); return; }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [lookup, stopCamera]);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      // 等 video 真正挂上再绑流并开扫
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        void v.play().then(() => { rafRef.current = requestAnimationFrame(scanLoop); });
      });
    } catch {
      setError("无法打开摄像头（可能未授权或被占用）。请用手机相机直接扫码，或手动输入编码。");
      setScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold"><PackageSearch className="h-5 w-5" />二维码查询</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-hover" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={e => { e.preventDefault(); void lookup(code); }} className="space-y-2">
          <div className="flex gap-2">
            <input ref={inputRef} value={code} onChange={e => setCode(e.target.value)}
              placeholder="扫码 / 输入 / 粘贴物料编码" aria-label="物料编码"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
            <button type="submit" disabled={busy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}查询
            </button>
          </div>
          <p className="text-xs text-faint">用扫码枪直接扫也行——它相当于自动输入编码并回车。</p>
        </form>

        {/* 摄像头 */}
        <div className="mt-3">
          {scanning ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} playsInline muted className="w-full rounded-lg border border-border bg-black" />
              <button onClick={stopCamera} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                <CameraOff className="h-4 w-4" />停止扫码
              </button>
            </div>
          ) : camera ? (
            <button onClick={() => void startCamera()} data-testid="start-camera"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
              <Camera className="h-4 w-4" />打开摄像头扫码
            </button>
          ) : (
            <p data-testid="camera-unavailable" className="rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {cameraUnavailableReason()}
            </p>
          )}
        </div>

        {error && <p className="mt-3 rounded-lg border-l-4 border-danger bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        {item && (
          <div className="mt-3 rounded-xl border border-border bg-surface-subtle p-3">
            <div className="font-mono text-xs text-faint">{item.code}</div>
            <div className="mt-0.5 font-medium">{item.name}</div>
            <div className="mt-1 text-xs text-muted">
              {item.grade} 级 · 在库 {item.quantity} · {item.locationCode || "库位未指定"} · {item.category || "未分类"}
            </div>
            <a href={`/i/${encodeURIComponent(item.code ?? "")}`} className="mt-2 inline-block text-xs text-sky-500 hover:text-sky-600">打开物料页 →</a>
          </div>
        )}
      </div>
    </div>
  );
}

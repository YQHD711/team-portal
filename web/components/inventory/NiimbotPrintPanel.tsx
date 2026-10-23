"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Printer } from "lucide-react";
import type { LabelData, LabelTemplate } from "@/lib/labelTemplate";
import { NiimbotPrinter, friendlyError, k3wSizeWarning, mapLabelToPrintPage } from "@/lib/niimbot";

interface Props {
  template: LabelTemplate;
  data: LabelData;
}

type PanelStatus = "idle" | "connecting" | "connected" | "printing" | "error";

const STATUS_TEXT: Record<PanelStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  connected: "已连接",
  printing: "打印中…",
  error: "连接失败",
};

/**
 * 物料标签弹窗里的「直连打印（精臣 K3W）」区块。
 *
 * 只在用户点击时连接，绝不自动连接（服务未安装时自动连会每 3 秒重试、刷控制台）。
 * 连接失败一律给出可执行提示 +「改用导出 PDF」的退路（HTTPS 下浏览器可能拦截本机 ws）。
 */
export default function NiimbotPrintPanel({ template, data }: Props) {
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<{ message: string; recovery?: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const clientRef = useRef<NiimbotPrinter | null>(null);

  useEffect(() => () => { void clientRef.current?.disconnect(); }, []);

  const client = (): NiimbotPrinter => {
    if (!clientRef.current) {
      clientRef.current = new NiimbotPrinter({
        onConnectionChange: open => {
          if (open) return;
          setDeviceName(null);
          setStatus(current => (current === "printing" ? current : "idle"));
        },
      });
    }
    return clientRef.current;
  };

  const fail = (err: unknown) => {
    setError(friendlyError(err));
    setStatus("error");
    setProgress("");
  };

  const handleConnect = async () => {
    setError(null);
    setPreviewUrl(null);
    setStatus("connecting");
    setProgress("正在连接本机打印服务…");
    try {
      const device = await client().connect(next => setProgress(next.message));
      setDeviceName(device.name);
      setStatus("connected");
      setProgress(`已连接 ${device.name}`);
    } catch (err) {
      fail(err);
    }
  };

  const handlePreview = async () => {
    setError(null);
    setProgress("正在生成打印预览…");
    try {
      const url = await client().preview(mapLabelToPrintPage(template, data), 8, next => setProgress(next.message));
      setPreviewUrl(url);
      setProgress("预览生成成功，确认版式后点「打印」");
    } catch (err) {
      fail(err);
    }
  };

  const handlePrint = async () => {
    setError(null);
    setStatus("printing");
    setProgress("正在启动打印任务…");
    try {
      await client().print(mapLabelToPrintPage(template, data), {
        copies: Math.max(1, Math.floor(copies) || 1),
        onProgress: next => setProgress(next.message),
      });
      setStatus("connected");
      setProgress("打印完成");
    } catch (err) {
      fail(err);
    }
  };

  const busy = status === "connecting" || status === "printing";
  const connected = status === "connected" || (status === "printing" && Boolean(deviceName));
  const sizeWarning = k3wSizeWarning(template);

  return (
    <section data-testid="niimbot-panel" className="mt-4 rounded-xl border border-border bg-surface-subtle p-3 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Printer className="h-4 w-4" />直连打印（精臣 K3W）
        </h3>
        <span data-testid="niimbot-status" data-status={status}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${connected ? "bg-success/15 text-success" : status === "error" ? "bg-danger/15 text-danger" : "bg-surface-hover text-muted"}`}>
          {STATUS_TEXT[status]}{deviceName ? `：${deviceName}` : ""}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        需在本机（Windows）安装并启动「精臣打印服务」，用 USB 连接 K3W。首次连接时浏览器可能弹出
        「访问本地设备」权限，请选择允许；打印失败可随时改用上面的「导出 PDF」。
      </p>

      {sizeWarning && (
        <p data-testid="niimbot-size-warning"
          className="mt-2 rounded-lg border-l-4 border-warning bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠️ {sizeWarning}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleConnect()} disabled={busy || connected}
          data-testid="niimbot-connect"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
          {status === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
          {connected ? "已连接" : "连接打印机"}
        </button>
        <button type="button" onClick={() => void handlePreview()} disabled={!connected || busy}
          data-testid="niimbot-preview-button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
          预览
        </button>
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          份数
          <input type="number" min={1} max={20} value={copies} data-testid="niimbot-copies"
            onChange={e => setCopies(Number(e.target.value) || 1)}
            className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs" />
        </label>
        <button type="button" onClick={() => void handlePrint()} disabled={!connected || busy}
          data-testid="niimbot-print"
          className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">
          {status === "printing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
          {status === "printing" ? "打印中…" : "直连打印"}
        </button>
      </div>

      {progress && (
        <p data-testid="niimbot-progress" className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-success" />}
          {progress}
        </p>
      )}

      {error && (
        <div data-testid="niimbot-error" className="mt-2 rounded-lg border-l-4 border-danger bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <p className="inline-flex items-start gap-1 font-medium"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{error.message}</p>
          {error.recovery && <p className="mt-1 whitespace-pre-wrap">{error.recovery}</p>}
        </div>
      )}

      {previewUrl && (
        /* eslint-disable-next-line @next/next/no-img-element -- 预览是 SDK 返回的 Base64 data URL，next/image 不适用 */
        <img data-testid="niimbot-preview" src={previewUrl} alt="直连打印预览" className="mt-2 max-h-40 rounded border border-border bg-white" />
      )}
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Loader2, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { downloadErrorMessage, saveBlob } from "@/lib/download";
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
 * 仅用户点击时连接，绝不自动连接（服务未安装时自动连会每 3 秒重试、刷控制台）。
 * 折叠策略：桌面默认展开（右侧操作区常驻），移动端默认折叠成一行标题，避免长面板把按钮挤出屏幕。
 * 连接失败一律给可执行提示 +「改用导出 PDF」的退路（HTTPS 下浏览器可能拦截本机 ws）。
 */
export default function NiimbotPrintPanel({ template, data }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<{ message: string; recovery?: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const clientRef = useRef<NiimbotPrinter | null>(null);

  useEffect(() => () => { void clientRef.current?.disconnect(); }, []);

  /** 移动端（< md）默认折叠；jsdom 没有 matchMedia，测试环境按桌面展开处理 */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setExpanded(!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

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
      setProgress("预览生成成功，确认版式后点「直连打印」");
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

  /**
   * 下载打印服务安装包：必须走 api.download（带 JWT），不能用 <a href> 直链——
   * 新标签页发不出 Authorization 头，后端会 401。文件名按交付包固定写死。
   */
  const downloadService = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await api.download("/api/downloads/print-service");
      saveBlob(blob, "jcPrinterSdk_4.2.1_20260902.exe");
    } catch (err) {
      // 401 已由 api.download 接管（清 token 跳登录），不再弹误导性失败提示
      const message = downloadErrorMessage(err);
      if (message) setDownloadError(`下载失败：${message}`);
    } finally {
      setDownloading(false);
    }
  };

  const busy = status === "connecting" || status === "printing";
  const connected = status === "connected" || (status === "printing" && Boolean(deviceName));
  const sizeWarning = k3wSizeWarning(template);

  return (
    <section data-testid="niimbot-panel" className="rounded-xl border border-border bg-surface-subtle print:hidden">
      <button type="button" data-testid="niimbot-toggle" aria-expanded={expanded} aria-controls="niimbot-panel-body"
        onClick={() => setExpanded(value => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-surface-hover">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Printer className="h-4 w-4 shrink-0" />
          <span className="truncate">直连打印（精臣 K3W）</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span data-testid="niimbot-status" data-status={status}
            className={`max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${connected ? "bg-success/15 text-success" : status === "error" ? "bg-danger/15 text-danger" : "bg-surface-hover text-muted"}`}>
            {STATUS_TEXT[status]}{deviceName ? `：${deviceName}` : ""}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && (
        <div id="niimbot-panel-body" data-testid="niimbot-panel-body" className="border-t border-border px-3 pb-3 pt-2">
          <div className="text-[11px] leading-relaxed text-faint">
            <p>
              需在本机（Windows）安装并启动「精臣打印服务」，用 USB 连接 K3W。首次连接时浏览器可能弹出
              「访问本地设备」权限，请选择允许；打印失败可随时改用「导出 PDF」。
            </p>
            <ul className="mt-1 space-y-0.5">
              <li>· K3W 支持 Wi-Fi（仅 2.4GHz）：首次配网必须先用 USB 连接，在精臣软件/打印服务里完成配网后即可无线打印；同一台电脑仍需安装打印服务。</li>
              <li>· 打印服务是浏览器与打印机之间的本机桥接，必须安装；Win10/11 一般免驱，Win7 需额外安装 K3W 驱动。</li>
            </ul>
            <button type="button" onClick={() => void downloadService()} disabled={downloading}
              data-testid="niimbot-download-service"
              className="mt-1.5 inline-flex min-h-10 max-w-full items-center justify-start gap-1 whitespace-normal rounded-lg border border-border px-2.5 py-1.5 text-left font-medium leading-snug text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloading ? "下载中…" : "下载打印服务安装包（Windows，约 37MB）"}
            </button>
            {downloadError && (
              <p data-testid="niimbot-download-error" className="mt-1.5 rounded border-l-2 border-danger bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {downloadError}
              </p>
            )}
          </div>

          {sizeWarning && (
            <p data-testid="niimbot-size-warning"
              className="mt-2 rounded border-l-2 border-warning bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠️ {sizeWarning}
            </p>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void handleConnect()} disabled={busy || connected}
              data-testid="niimbot-connect"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
              {status === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              <span className="truncate">{connected ? "已连接" : "连接打印机"}</span>
            </button>
            <button type="button" onClick={() => void handlePreview()} disabled={!connected || busy}
              data-testid="niimbot-preview-button"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
              预览
            </button>
          </div>

          <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <label className="inline-flex min-h-10 items-center gap-1 text-xs text-muted">
              份数
              <input type="number" min={1} max={20} value={copies} data-testid="niimbot-copies"
                onChange={e => setCopies(Number(e.target.value) || 1)}
                className="min-h-10 w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs" />
            </label>
            <button type="button" onClick={() => void handlePrint()} disabled={!connected || busy}
              data-testid="niimbot-print"
              title={connected ? "按当前模板直连打印" : "请先连接打印机"}
              className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
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
        </div>
      )}
    </section>
  );
}

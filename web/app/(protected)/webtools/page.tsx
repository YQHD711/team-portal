import { ExternalLink } from "lucide-react";

// 走 /webtools/index.html:前端 rewrite → backend WebToolsStaticMiddleware 托管。
// 用相对路径而不是写死的 localhost:8123,保证部署在任意域名/IP 都能用。
// 同源路径让新窗口/iframe 与主站同源,File System Access API 可正常调用。
const WEBTOOLS_URL = "/webtools/index.html";
const WEBTOOLS_IFRAME_SRC = "/webtools/index.html";

export default function WebToolsPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">飞行日志分析工具集</h1>
          <p className="text-sm text-muted">ArduPilot WebTools · 日志分析、图表绘制与飞行数据可视化</p>
        </div>
        <a
          href={WEBTOOLS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <ExternalLink className="h-4 w-4" />
          新窗口打开
        </a>
      </div>

      <div className="flex-1 min-h-0 rounded-xl border border-border overflow-hidden bg-surface">
        <iframe
          src={WEBTOOLS_IFRAME_SRC}
          title="飞行日志分析工具集"
          allow="file-system-access"
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
}

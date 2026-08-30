import { ExternalLink } from "lucide-react";

// 新窗口直连 WebTools 静态站点；iframe 走 /webtools/index.html 同源路径
// （Next rewrite → 后端 WebToolsStaticMiddleware 托管静态目录，同源可用 File System Access API）
const WEBTOOLS_URL = "http://localhost:8123";
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

"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronRight, ChevronLeft, BookOpen, ExternalLink, ArrowLeft, Loader2, RefreshCw, Globe, Building2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface CatalogItem { path: string; title: string; children?: CatalogItem[]; }
interface TaskInfo { id: string; projectName: string; status: string; targetFolder: string; visibility: string; type: string; }

export default function WikiViewerPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskInfo | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [activePath, setActivePath] = useState<string>("");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const [updating, setUpdating] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);

  // Extract TOC from content headings
  useEffect(() => {
    if (!content) { setToc([]); return; }
    const headings = content.match(/^#{1,3} .+$/gm) || [];
    setToc(headings.map(h => {
      const level = h.match(/^#+/)?.[0].length ?? 1;
      const text = h.replace(/^#+\s*/, "");
      return { id: text.toLowerCase().replace(/[^\w一-鿿]+/g, "-"), text, level };
    }));
  }, [content]);

  // Handle internal link clicks within the doc viewer
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "A") {
      const href = target.getAttribute("href");
      if (href?.startsWith("?path=")) {
        e.preventDefault();
        const params = new URLSearchParams(href);
        const newPath = params.get("path");
        if (newPath) setActivePath(decodeURIComponent(newPath));
      }
    }
  };

  useEffect(() => {
    api.get<TaskInfo>(`/api/wiki/tasks/${taskId}`).then(setTask).catch(() => {});
    api.get<CatalogItem[]>(`/api/wiki/tasks/${taskId}/catalog`)
      .then(c => {
        setCatalog(c);
        // Auto-expand first level, auto-select first leaf
        const firstLevels = new Set(c.map(i => i.path));
        setExpanded(firstLevels);
        const firstLeaf = findFirstLeaf(c);
        if (firstLeaf) setActivePath(firstLeaf);
      })
      .catch(() => setCatalog([]));
  }, [taskId]);

  useEffect(() => {
    if (!activePath) return;
    setLoading(true);
    api.get<{ content: string }>(`/api/wiki/tasks/${taskId}/doc?path=${encodeURIComponent(activePath)}&lang=${lang}`)
      .then(d => setContent(d.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [activePath, taskId, lang]);

  const findFirstLeaf = (items: CatalogItem[]): string | null => {
    for (const item of items) {
      if (item.children?.length) { const f = findFirstLeaf(item.children); if (f) return f; }
      else return item.path;
    }
    return null;
  };

  const toggleExpand = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    setExpanded(next);
  };

  const renderTree = (items: CatalogItem[], depth: number = 0) => (
    <ul className={depth === 0 ? "space-y-0.5" : "space-y-0.5 border-l border-border ml-3 pl-2"}>
      {items.map(item => {
        const hasChildren = item.children && item.children.length > 0;
        const isActive = activePath === item.path;
        const isOpen = expanded.has(item.path);

        return (
          <li key={item.path}>
            {hasChildren ? (
              <>
                <button onClick={() => toggleExpand(item.path)}
                  className="flex items-center gap-1 w-full text-left px-2 py-1.5 rounded text-sm hover:bg-surface-hover text-zinc-600 dark:text-faint font-medium">
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
                  {item.title}
                </button>
                {isOpen && renderTree(item.children!, depth + 1)}
              </>
            ) : (
              <button onClick={() => setActivePath(item.path)}
                className={cn(
                  "flex items-center gap-1 w-full text-left px-2 py-1.5 rounded text-sm transition-colors",
                  isActive ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-medium" : "hover:bg-surface-hover text-zinc-600 dark:text-faint"
                )}>
                <span className="w-3.5 shrink-0" />
                {item.title}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-6">
      {/* Sidebar */}
      <div className={cn(
        "border-r border-border bg-surface flex flex-col transition-all duration-200",
        sidebarOpen ? "w-64 min-w-[16rem]" : "w-0 min-w-0 overflow-hidden border-r-0"
      )}>
        {/* Project header */}
        <div className="px-4 py-3 border-b border-border">
          <button onClick={() => router.push("/wiki")} className="flex items-center gap-1 text-xs text-faint hover:text-zinc-600 mb-2 transition-colors">
            <ArrowLeft className="h-3 w-3" /> 返回任务列表
          </button>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-sky-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-sm truncate">{task?.projectName || "加载中..."}</h2>
              <p className="text-xs text-faint">{task?.status === "completed" ? "项目文档" : task?.status || "加载中..."}</p>
            </div>
            {task?.type === "translate" && (
              <div className="flex items-center gap-0.5 ml-2">
                {[{ v: "zh", l: "中" }, { v: "en", l: "EN" }].map(o => (
                  <button key={o.v} onClick={() => setLang(o.v as "zh" | "en")}
                    className={`px-1.5 py-0.5 text-xs rounded font-medium transition-colors ${lang === o.v ? "bg-primary text-white" : "bg-surface-subtle text-muted"}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            )}
            {isStaff && task?.status === "completed" && (
              <>
                <button
                  disabled={updating}
                  onClick={async () => {
                    setUpdating(true);
                    try { await api.post(`/api/wiki/tasks/${taskId}/update`, {}); }
                    catch { alert("更新失败"); }
                    finally { setUpdating(false); }
                  }}
                  className="ml-auto flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 hover:bg-sky-100 transition-colors disabled:opacity-50 shrink-0"
                  title="AI 审查并修正文档中的问题"
                >
                  <RefreshCw className={cn("h-3 w-3", updating && "animate-spin")} />
                  {updating ? "更新中..." : "检查修正"}
                </button>
                <select
                  value={task.visibility}
                  onChange={async (e) => {
                    const v = e.target.value;
                    try { await fetch(`/api/wiki/tasks/${taskId}/visibility`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` }, body: JSON.stringify({ visibility: v }) }); setTask({ ...task, visibility: v }); }
                    catch { }
                  }}
                  className="ml-1 px-2 py-1 text-xs rounded-lg border border-border dark:border-zinc-700 bg-surface shrink-0"
                >
                  <option value="public">🌐 公共</option>
                  <option value="department">🏢 部门</option>
                  <option value="personal">🔒 个人</option>
                </select>
              </>
            )}
            {!isStaff && (
              <span className="ml-auto text-xs text-faint shrink-0">
                {task?.visibility === "department" ? "🏢 部门" : task?.visibility === "personal" ? "🔒 个人" : "🌐 公共"}
              </span>
            )}
          </div>
        </div>
        {/* Catalog tree */}
        <div className="flex-1 overflow-y-auto p-3">
          {catalog.length > 0 ? renderTree(catalog) : (
            <div className="text-center text-sm text-faint py-8">
              <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
              加载目录...
            </div>
          )}
        </div>
      </div>

      {/* Toggle */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)}
        className="shrink-0 flex items-center justify-center w-7 hover:bg-surface-hover transition-colors border-r border-border text-faint">
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-0 max-w-6xl mx-auto">
          <div className="flex-1 min-w-0 p-6 lg:p-10" onClick={handleContentClick}>
            {loading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-8 bg-surface-hover rounded w-1/3" />
                <div className="h-4 bg-surface-hover rounded w-2/3" />
                <div className="h-64 bg-surface-subtle rounded mt-6" />
              </div>
            ) : content ? (
              <MarkdownRenderer content={content} />
            ) : (
              <div className="text-center py-20 text-faint">
                <BookOpen className="h-10 w-10 mx-auto mb-3 text-zinc-300" />
                选择目录中的文档开始阅读
              </div>
            )}
          </div>
          {/* TOC sidebar */}
          {toc.length > 1 && (
            <div className="hidden xl:block w-56 shrink-0 border-l border-border p-4 overflow-y-auto sticky top-14 self-start" style={{ maxHeight: "calc(100vh - 7rem)" }}>
              <h4 className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">本页目录</h4>
              <nav className="space-y-0.5">
                {toc.map(h => (
                  <a key={h.id} href={`#${h.id}`}
                    className="block text-xs text-muted hover:text-sky-600 dark:hover:text-sky-400 truncate py-0.5"
                    style={{ paddingLeft: `${(h.level - 1) * 0.75}rem` }}>
                    {h.text}
                  </a>
                ))}
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

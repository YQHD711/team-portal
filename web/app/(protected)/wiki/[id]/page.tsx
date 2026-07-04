"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronRight, ChevronLeft, BookOpen, ExternalLink, ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CatalogItem { path: string; title: string; children?: CatalogItem[]; }
interface TaskInfo { id: string; projectName: string; status: string; targetFolder: string; }

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
    api.get<{ content: string }>(`/api/wiki/tasks/${taskId}/doc?path=${encodeURIComponent(activePath)}`)
      .then(d => setContent(d.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [activePath, taskId]);

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
    <ul className={depth === 0 ? "space-y-0.5" : "space-y-0.5 border-l border-zinc-200 dark:border-zinc-800 ml-3 pl-2"}>
      {items.map(item => {
        const hasChildren = item.children && item.children.length > 0;
        const isActive = activePath === item.path;
        const isOpen = expanded.has(item.path);

        return (
          <li key={item.path}>
            {hasChildren ? (
              <>
                <button onClick={() => toggleExpand(item.path)}
                  className="flex items-center gap-1 w-full text-left px-2 py-1.5 rounded text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
                  {item.title}
                </button>
                {isOpen && renderTree(item.children!, depth + 1)}
              </>
            ) : (
              <button onClick={() => setActivePath(item.path)}
                className={cn(
                  "flex items-center gap-1 w-full text-left px-2 py-1.5 rounded text-sm transition-colors",
                  isActive ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-medium" : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
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
        "border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col transition-all duration-200",
        sidebarOpen ? "w-64 min-w-[16rem]" : "w-0 min-w-0 overflow-hidden border-r-0"
      )}>
        {/* Project header */}
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <button onClick={() => router.push("/wiki")} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 mb-2 transition-colors">
            <ArrowLeft className="h-3 w-3" /> 返回任务列表
          </button>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-sky-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-sm truncate">{task?.projectName || "加载中..."}</h2>
              <p className="text-xs text-zinc-400">项目文档</p>
            </div>
          </div>
        </div>
        {/* Catalog tree */}
        <div className="flex-1 overflow-y-auto p-3">
          {catalog.length > 0 ? renderTree(catalog) : (
            <div className="text-center text-sm text-zinc-400 py-8">
              <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
              加载目录...
            </div>
          )}
        </div>
      </div>

      {/* Toggle */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)}
        className="shrink-0 flex items-center justify-center w-7 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-r border-zinc-200 dark:border-zinc-800 text-zinc-400">
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 lg:p-10">
          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3" />
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3" />
              <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-1/2" />
              <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded mt-6" />
            </div>
          ) : content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="text-center py-20 text-zinc-400">
              <BookOpen className="h-10 w-10 mx-auto mb-3 text-zinc-300" />
              选择目录中的文档开始阅读
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

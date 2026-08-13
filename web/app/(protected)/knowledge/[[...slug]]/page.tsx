"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { TreeView } from "@/components/knowledge/TreeView";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronLeft, ChevronRight, BookOpen, Pencil, Save, X, Search, Loader2 } from "lucide-react";

interface TreeNode { name: string; type: "folder" | "file"; path?: string; children?: TreeNode[]; }
interface SearchResult { path: string; snippet: string; score: number; }

export default function KnowledgePage() {
  const params = useParams();
  const slug = params.slug as string[] | undefined;
  const filePath = slug ? slug.join("/") : null;

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user } = useCurrentUser();
  const role = user?.role ?? null;
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      setSearchResults(data.sources || []);
      setShowResults(true);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const navigateTo = (path: string) => {
    router.push(`/knowledge/${path.replace(/\.md$/, "")}`);
    setShowResults(false);
    setSearchQuery("");
  };

  const canEdit = role === "admin" || role === "部长";

  useEffect(() => {
    api.get<TreeNode[]>("/api/knowledge/tree").then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!filePath) { setContent(null); setLoading(false); return; }
    const fullPath = filePath + ".md";
    setLoading(true);
    api.get<{content:string}>("/api/knowledge/content?path=" + encodeURIComponent(fullPath))
      .then(data => setContent(data.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [filePath]);

  // Save to recently viewed in localStorage
  useEffect(() => {
    if (!filePath || !content) return;
    try {
      const recent = JSON.parse(localStorage.getItem("recentDocs") || "[]");
      const entry = { path: filePath, title: content.split("\n")[0]?.replace(/^# /, "") || filePath, time: Date.now() };
      const filtered = recent.filter((r: { path: string }) => r.path !== filePath);
      filtered.unshift(entry);
      localStorage.setItem("recentDocs", JSON.stringify(filtered.slice(0, 20)));
    } catch {}
  }, [filePath, content]);

  // Auto-close sidebar on mobile when content loads
  useEffect(() => {
    if (filePath && typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [filePath]);

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-3 sm:-m-6 max-w-6xl mx-auto relative">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Tree sidebar */}
      <div
        className={`border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto transition-all duration-300 ${
          sidebarOpen
            ? "fixed lg:relative z-50 left-0 top-0 h-full w-72 lg:w-64 lg:min-w-[16rem] shadow-2xl lg:shadow-none"
            : "w-0 min-w-0 border-r-0 overflow-hidden"
        }`}
      >
        <div className="p-3" ref={searchRef}>
          {/* Search bar */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5">
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" /> : <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />}
              <input
                type="text" value={searchQuery} placeholder="搜索文档..."
                onChange={e => handleSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
              {searchQuery && <button onClick={() => { setSearchQuery(""); setShowResults(false); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3.5 w-3.5" /></button>}
            </div>
            {showResults && searchResults.length > 0 && (
              <div className="absolute z-50 left-3 right-3 mt-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl max-h-80 overflow-y-auto">
                {searchResults.map(r => (
                  <button key={r.path} onClick={() => navigateTo(r.path)}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <div className="text-sm font-medium truncate">{r.path.replace(/\.md$/, "").replace(/\//g, " / ")}</div>
                    <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{r.snippet.slice(0, 150)}</div>
                  </button>
                ))}
              </div>
            )}
            {showResults && searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
              <div className="absolute z-50 left-3 right-3 mt-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-3 text-sm text-zinc-500 text-center">未找到匹配的文档</div>
            )}
          </div>
          <TreeView nodes={tree} />
        </div>
      </div>

      {/* Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="shrink-0 flex items-center justify-center w-8 sm:w-7 min-h-[2rem] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-r border-zinc-200 dark:border-zinc-800 text-zinc-400"
        aria-label={sidebarOpen ? "关闭目录" : "打开目录"}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-3xl">
          {filePath && canEdit && !editing && !loading && content && (
            <div className="flex justify-end mb-2">
              <button onClick={() => { setEditing(true); setEditContent(content); }} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
                <Pencil className="h-3 w-3" /> 编辑
              </button>
            </div>
          )}

          {editing ? (
            <div className="space-y-3">
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                className="w-full h-[50vh] p-4 font-mono text-sm border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
              <div className="flex gap-2">
                <button onClick={async () => {
                  setSaving(true);
                  try { await api.post("/api/admin/knowledge/write", { path: filePath + ".md", content: editContent }); setContent(editContent); setEditing(false); }
                  catch { alert("保存失败"); }
                  finally { setSaving(false); }
                }} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600">
                  <Save className="h-4 w-4" />{saving?"保存中...":"保存"}
                </button>
                <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"><X className="h-4 w-4" />取消</button>
              </div>
            </div>
          ) : (
            loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3" />
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3" />
              <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-1/2" />
            </div>
          ) : content ? (
            <MarkdownRenderer content={content} />
          ) : filePath ? (
            <div className="text-center py-16 text-zinc-500">文件未找到</div>
          ) : (
            <div className="text-center py-20">
              <BookOpen className="h-12 w-12 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
              <p className="text-zinc-500 dark:text-zinc-400">请从左侧目录选择文档</p>
              <p className="text-xs text-zinc-400 mt-1">将 .md 文件放入 data/knowledge/ 目录</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

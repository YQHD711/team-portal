"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { TreeView } from "@/components/knowledge/TreeView";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronLeft, ChevronRight, BookOpen, Pencil, Save, X } from "lucide-react";

interface TreeNode { name: string; type: "folder" | "file"; path?: string; children?: TreeNode[]; }

export default function KnowledgePage() {
  const params = useParams();
  const slug = params.slug as string[] | undefined;
  const filePath = slug ? slug.join("/") : null;

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get<{role:string}>("/api/admin/me").then(u => setRole(u.role)).catch(()=>{}); }, []);
  const canEdit = role === "admin" || role === "部长";

  useEffect(() => {
    api.get<TreeNode[]>("/api/knowledge/tree").then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!filePath) { setContent(null); setLoading(false); return; }
    const fullPath = filePath + ".md";
    const url = `/api/knowledge/content?path=${encodeURIComponent(fullPath)}`;
    console.log("[KnowledgePage] filePath:", filePath, "| fullPath:", fullPath, "| url:", url);
    setLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(async r => {
        const text = await r.text();
        console.log("[KnowledgePage] status:", r.status, "| body:", text.substring(0, 200));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = JSON.parse(text);
        setContent(data.content);
      })
      .catch(e => { console.error("[KnowledgePage] error:", e.message); setContent(null); })
      .finally(() => setLoading(false));
  }, [filePath]);

  // Auto-close sidebar on mobile when content loads
  useEffect(() => {
    if (filePath && typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [filePath]);

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-6 max-w-6xl mx-auto">
      {/* Tree sidebar */}
      <div
        className={`border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto transition-all duration-300 ${
          sidebarOpen ? "w-64 min-w-[16rem]" : "w-0 min-w-0 border-r-0 overflow-hidden"
        }`}
      >
        <div className="p-3">
          <TreeView nodes={tree} />
        </div>
      </div>

      {/* Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="shrink-0 flex items-center justify-center w-7 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-r border-zinc-200 dark:border-zinc-800 text-zinc-400"
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

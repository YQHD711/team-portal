"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { FileText, Plus, Trash2, Save, FolderPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNode { name: string; type: "folder" | "file"; path?: string; children?: TreeNode[]; }

export default function KnowledgeAdminPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showNew, setShowNew] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTree = useCallback(() => {
    api.get<TreeNode[]>("/api/knowledge/tree").then(setTree);
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const loadFile = async (path: string) => {
    try {
      const data = await api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(path)}`);
      setContent(data.content); setOriginal(data.content); setSelected(path); setDirty(false);
    } catch { alert("加载失败"); }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post(`/api/admin/knowledge/write?path=${encodeURIComponent(selected)}`, content);
      setOriginal(content); setDirty(false);
    } catch { alert("保存失败"); }
    finally { setSaving(false); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const path = showNew === "folder" ? newName + "/.gitkeep" : newName + ".md";
    try {
      await api.post(`/api/admin/knowledge/write?path=${encodeURIComponent(path)}`, showNew === "folder" ? "" : "# " + newName + "\n\n");
      setShowNew(null); setNewName(""); fetchTree();
    } catch { alert("创建失败"); }
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`确认删除 "${path}"？此操作不可撤销。`)) return;
    try {
      await api.delete(`/api/admin/knowledge/delete?path=${encodeURIComponent(path)}`);
      if (selected === path) { setSelected(null); setContent(""); }
      fetchTree();
    } catch { alert("删除失败"); }
  };

  const renderTree = (nodes: TreeNode[], level = 0) => (
    <ul className={level === 0 ? "space-y-0.5" : "ml-4 space-y-0.5"}>
      {nodes.map(n => (
        <li key={n.name + (n.path ?? "")}>
          {n.type === "folder" ? (
            <div className="flex items-center gap-1 group">
              <span className="text-xs text-zinc-400 font-medium px-1">{n.name}/</span>
              <button onClick={() => handleDelete(n.path ?? n.name)} className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500" title="删除文件夹"><Trash2 className="h-3 w-3" /></button>
            </div>
          ) : (
            <button onClick={() => loadFile(n.path!)} className={cn("flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800", selected === n.path && "bg-sky-50 dark:bg-sky-950 text-sky-700")}>
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="truncate">{n.name}</span>
            </button>
          )}
          {n.children && renderTree(n.children, level + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">资料管理</h1><p className="text-sm text-zinc-500">管理知识库中的 Markdown 文档</p></div>
        <div className="flex gap-2">
          <button onClick={() => { setShowNew("file"); setNewName(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><Plus className="h-4 w-4" />新建文档</button>
          <button onClick={() => { setShowNew("folder"); setNewName(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><FolderPlus className="h-4 w-4" />新建目录</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4 h-[calc(100vh-12rem)]">
        {/* Tree */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 overflow-y-auto">
          {renderTree(tree[0]?.children ?? [])}
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <span className="text-sm font-medium truncate">{selected}</span>
                <div className="flex items-center gap-2">
                  {dirty && <span className="text-xs text-amber-500">未保存</span>}
                  <button onClick={handleSave} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors">
                    <Save className="h-3.5 w-3.5" />{saving ? "保存中..." : "保存"}
                  </button>
                  <button onClick={() => handleDelete(selected)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <textarea value={content} onChange={e => { setContent(e.target.value); setDirty(e.target.value !== original); }}
                className="flex-1 w-full p-4 resize-none font-mono text-sm bg-transparent focus:outline-none" placeholder="编辑 Markdown 内容..." spellCheck={false} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <div className="text-center"><FileText className="h-10 w-10 mx-auto mb-2 text-zinc-300" />选择文件开始编辑</div>
            </div>
          )}
        </div>
      </div>

      {/* New item modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowNew(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{showNew === "file" ? "新建文档" : "新建目录"}</h2><button onClick={() => setShowNew(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button></div>
            <form onSubmit={e => { e.preventDefault(); handleCreate(); }} className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">名称{showNew === "file" && "（无需 .md 后缀）"}</label><input value={newName} onChange={e => setNewName(e.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required autoFocus /></div>
              <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600">创建</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

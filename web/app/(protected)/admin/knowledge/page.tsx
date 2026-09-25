"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { FileText, Plus, Trash2, Save, FolderPlus, X, Upload, Loader2, Eye, Columns, ChevronRight, Shield, ImagePlus } from "lucide-react";
import { getToken, isStaff } from "@/lib/auth";
import { useCurrentUser } from "@/lib/hooks";
import DOMPurify from "dompurify";
import { ancestorFolders, findFirstFile, isTextFile, type TreeNode } from "@/lib/knowledgeTree";
import { KnowledgeTree } from "@/components/knowledge/KnowledgeTree";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";

/** 读 URL 查询参数（SSR 时没有 window）。用于搜索结果/「编辑本库」跳转。 */
function urlParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

/**
 * 取错误的可读原因。api 客户端会把后端的 detail 放进 Error.message，
 * 以前这里一律 alert("保存失败") 把它丢了 —— 结果"能读不能写"这类问题
 * 完全没有线索可查（同样的坑前面在 ?path= 深链接上踩过一次）。
 */
function reason(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "未知错误";
}

export default function KnowledgeAdminPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showNew, setShowNew] = useState<"file" | "folder" | "upload" | null>(null);
  const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null);
  const [renameNew, setRenameNew] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState("公共");
  const [uploadMsg, setUploadMsg] = useState("");
  const [preview, setPreview] = useState(() => !!urlParam("q"));
  const [splitMode, setSplitMode] = useState(false);
  const [searchKw] = useState(() => urlParam("q"));
  const [cssContent, setCssContent] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [imageMsg, setImageMsg] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const deepLinkApplied = useRef(false);

  const { user } = useCurrentUser();
  const canEdit = isStaff();

  const openFileAt = useCallback((file: string) => {
    setExpanded(prev => new Set([...prev, ...ancestorFolders(file)]));
    api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(file)}`)
      .then(d => { setContent(d.content); setOriginal(d.content); setSelected(file); setDirty(false); })
      .catch(() => setNotice("文档加载失败（可能没有权限）"));
  }, []);

  /**
   * 拉目录树；首次到位后顺带解析 ?path=。
   *
   * 这个 ?path= 可能是**目录**（例如从学习库点「编辑本库」跳过来）。
   * 旧实现一律按文件去请求 content，目录必然失败、又被 .catch 静默吞掉，
   * 于是"跳过来了却一片空白、也不报错"。现在目录就展开它并打开里面第一个文档。
   * 放在 .then 里而不是 effect 体内，避免 effect 里同步 setState。
   */
  const fetchTree = useCallback(() => {
    api.get<TreeNode[]>("/api/knowledge/tree").then(nodes => {
      setTree(nodes);
      if (deepLinkApplied.current) return;
      deepLinkApplied.current = true;

      const target = urlParam("path");
      if (!target) return;
      if (isTextFile(target)) { openFileAt(target); return; }

      setExpanded(prev => new Set([...prev, target, ...ancestorFolders(target)]));
      const first = findFirstFile(nodes, target);
      if (first) openFileAt(first);
      else setNotice(`「${target}」下还没有文档，可用右上角「新建文档」创建`);
    });
  }, [openFileAt]);
  useEffect(() => { fetchTree(); }, [fetchTree]);

  // 跨项目预览时套原文档的 CSS(Wiki 翻译项目把仓库 assets/ 复制到知识库,这里加载套到预览)
  useEffect(() => {
    if (!selected) { setCssContent(""); return; }
    const m = selected.match(/^[^/]+\/([^/]+)\//);
    if (!m || m[1].endsWith("_EN")) { setCssContent(""); return; }
    const projectName = m[1];
    const candidates = [
      `公共/${projectName}/assets/style.css`,
      `公共/${projectName}/assets/css/style.css`,
      `公共/${projectName}/_assets/style.css`,
    ];
    (async () => {
      for (const p of candidates) {
        try {
          const r = await api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(p)}`);
          if (r?.content) { setCssContent(r.content); return; }
        } catch {}
      }
      setCssContent("");
    })();
  }, [selected]);

  const loadFile = async (path: string) => {
    try {
      const data = await api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(path)}`);
      setContent(data.content); setOriginal(data.content); setSelected(path); setDirty(false);
    } catch {
      // 跨页 fallback:中文找不到则试 EN 版(Wiki 翻译任务结构 targetFolder/projectName/... vs targetFolder/projectName_EN/...)
      const m = path.match(/^([^/]+\/)([^/]+)(\/.+)$/);
      if (m) {
        const proj = m[2].endsWith("_EN") ? m[2].slice(0, -3) : m[2] + "_EN";
        const fallback = `${m[1]}${proj}${m[3]}`;
        try {
          const data = await api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(fallback)}`);
          setContent(data.content); setOriginal(data.content); setSelected(fallback); setDirty(false);
          return;
        } catch {}
      }
      alert("加载失败");
    }
  };
  const handleSave = async () => {
    if (!selected) return; setSaving(true);
    try { await api.post("/api/admin/knowledge/write", { path: selected, content }); setOriginal(content); setDirty(false); }
    catch (err) { alert("保存失败：\n" + reason(err)); } finally { setSaving(false); }
  };
  const handleCreate = async () => {
    if (!newName.trim()) return;
    const path = showNew === "folder" ? newName + "/.gitkeep" : newName + ".md";
    try { await api.post("/api/admin/knowledge/write", { path, content: showNew === "folder" ? "" : "# " + newName + "\n\n" }); setShowNew(null); setNewName(""); fetchTree(); }
    catch (err) { alert("创建失败：\n" + reason(err)); }
  };
  const handleDelete = async (path: string) => {
    if (!confirm(`确认删除 "${path}"？此操作不可撤销。`)) return;
    try { await api.delete(`/api/admin/knowledge/delete?path=${encodeURIComponent(path)}`); if (selected === path) { setSelected(null); setContent(""); } fetchTree(); }
    catch (err) { alert("删除失败：\n" + reason(err)); }
  };
  const openRename = (n: TreeNode) => { setRenameTarget(n); setRenameNew(n.name); };
  const handleRename = async () => {
    if (!renameTarget || !renameNew.trim()) return;
    const old = renameTarget.path ?? renameTarget.name;
    const dir = old.includes("/") ? old.slice(0, old.lastIndexOf("/") + 1) : "";
    const ext = renameTarget.type === "file" ? (renameTarget.extra?.ext ?? ".md") : "";
    const newPath = dir + renameNew.trim() + ext;
    if (newPath === old) { setRenameTarget(null); return; }
    try { await api.post("/api/admin/knowledge/rename", { path: old, newPath }); setRenameTarget(null); fetchTree(); if (selected === old) setSelected(newPath); }
    catch (err) { alert("重命名失败：\n" + reason(err)); }
  };
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setUploadMsg("");
    try {
      const token = getToken();
      const formData = new FormData(); formData.append("file", file);
      const res = await fetch(`/api/admin/documents/upload?folder=${encodeURIComponent(uploadFolder)}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: "Upload failed" })); throw new Error(err.detail || "Upload failed"); }
      const data = await res.json(); setUploadMsg(`✅ 上传成功: ${data.path}`); setShowNew(null); fetchTree();
    } catch (err) { setUploadMsg(`❌ ${err instanceof Error ? err.message : "上传失败"}`); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  /** 把一段 Markdown 插到光标处（没有光标就追加到末尾），并标记为未保存。 */
  const insertAtCursor = (snippet: string) => {
    const el = editorRef.current;
    const at = el && el.selectionStart !== null ? el.selectionStart : content.length;
    const end = el && el.selectionEnd !== null ? el.selectionEnd : at;
    const next = content.slice(0, at) + snippet + content.slice(end);
    setContent(next);
    setDirty(next !== original);
    // 光标落在插入内容之后，方便继续写
    requestAnimationFrame(() => {
      const box = editorRef.current;
      if (box) { box.focus(); box.setSelectionRange(at + snippet.length, at + snippet.length); }
    });
  };

  /**
   * 插入图片：上传到当前文档所在目录，再把 `![文件名](文件名)` 写到光标处。
   * 路径写成**同目录相对名**，文档整体挪目录也不会失效。
   */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const dir = selected.split("/").slice(0, -1).join("/");
    setImageUploading(true); setImageMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<{ path: string }>(`/api/admin/knowledge/asset?dir=${encodeURIComponent(dir)}`, form);
      const name = res.path.split("/").pop() ?? res.path;
      insertAtCursor(`${content.endsWith("\n") || content.length === 0 ? "" : "\n"}![${name}](${name})\n`);
      setImageMsg(`✅ 已插入 ${name}`);
      fetchTree();
    } catch (err) { setImageMsg(`❌ 上传失败：${reason(err)}`); }
    finally { setImageUploading(false); if (imageRef.current) imageRef.current.value = ""; }
  };

  const previewHtml = useMemo(() => {
    let html = content
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-500 underline">$1</a>')
      .replace(/\n/g, '<br/>');
    if (searchKw) {
      const esc = searchKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(esc, "g"), (m) => `<mark class="bg-yellow-200 dark:bg-yellow-700">${m}</mark>`);
    }
    return DOMPurify.sanitize(html);
  }, [content, searchKw]);

  // 定位到第一个关键词（搜索结果跳转后滚动到高亮处）
  useEffect(() => {
    if (!searchKw) return;
    const t = setTimeout(() => previewRef.current?.querySelector("mark")?.scrollIntoView({ block: "center" }), 150);
    return () => clearTimeout(t);
  }, [searchKw, preview, content]);


  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* 顶部管理端徽章 + 面包屑 */}
      <nav className="flex items-center gap-1.5 text-xs text-faint">
        <Link href="/admin/organization" className="hover:text-foreground transition-colors">管理端</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">知识库管理</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-sky-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              资料管理
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-950 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                <Shield className="h-3 w-3" /> 管理端
              </span>
            </h1>
            <p className="text-sm text-muted">{canEdit ? "管理知识库文档 · 含编辑/上传/删除权限" : "浏览知识库文档 · 只读模式"}</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setShowNew("file"); setNewName(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><Plus className="h-4 w-4" />新建文档</button>
            <button onClick={() => { setShowNew("folder"); setNewName(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><FolderPlus className="h-4 w-4" />新建目录</button>
            <button onClick={() => { setShowNew("upload"); setUploadMsg(""); }} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors shadow-sm"><Upload className="h-4 w-4" />上传文件</button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-4 lg:h-[calc(100vh-12rem)]">
        <div className="rounded-xl border border-border bg-surface p-3 overflow-y-auto max-h-72 lg:max-h-none">
          <KnowledgeTree
            // 必须传整棵树的**根数组**：/api/knowledge/tree 返回 [公共知识库, 飞训部, ...]，
            // 部门与公共是平级的根节点。此前只传 tree[0].children，
            // 于是部门下的文档在树里完全看不到（右侧能打开、左侧找不到它在哪）。
            nodes={tree}
            selected={selected} canEdit={canEdit} role={user?.role}
            expanded={expanded} onExpandedChange={setExpanded}
            onOpenFile={n => {
              if (isTextFile(n.path!)) loadFile(n.path!);
              else window.open(`/api/knowledge/download?path=${encodeURIComponent(n.path!)}`, "_blank");
            }}
            onRename={openRename}
            onDelete={handleDelete} />
        </div>

        <div className="lg:col-span-3 rounded-xl border border-border bg-surface flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
                <span className="text-sm font-medium truncate">{selected}</span>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    {dirty && <span className="text-xs text-amber-500">未保存</span>}
                    {imageMsg && <span className="text-xs text-muted">{imageMsg}</span>}
                    <button onClick={() => imageRef.current?.click()} disabled={imageUploading}
                      className="p-1.5 rounded text-xs text-faint hover:text-sky-600 disabled:opacity-50" title="插入图片">
                      {imageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                    </button>
                    <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleImageUpload} className="hidden" />
                    <button onClick={() => { setSplitMode(!splitMode); setPreview(false); }} className={`p-1.5 rounded text-xs ${splitMode ? "bg-sky-100 text-sky-600" : "text-faint"}`} title="分栏编辑"><Columns className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { setPreview(!preview); if (preview) setSplitMode(false); }} className={`p-1.5 rounded text-xs ${preview ? "bg-sky-100 text-sky-600" : "text-faint"}`} title="预览"><Eye className="h-3.5 w-3.5" /></button>
                    <button onClick={handleSave} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"><Save className="h-3.5 w-3.5" />{saving ? "保存中..." : "保存"}</button>
                    <button onClick={() => handleDelete(selected)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              {preview && canEdit ? (
                <>
                  {cssContent && <style dangerouslySetInnerHTML={{ __html: cssContent }} />}
                  {/*
                    搜索时仍用正则预览：它会在命中处插 <mark> 并支持跳到关键词。
                    普通预览改用与学习库/Wiki 同一个渲染器 —— 之前的正则版只认标题/加粗/链接，
                    表格、代码块、图片都不显示，作者没法确认自己写的东西长什么样。
                  */}
                  {searchKw
                    ? <div ref={previewRef} className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    : <div className="flex-1 overflow-y-auto p-4"><MarkdownRenderer content={content} docPath={selected ?? undefined} /></div>}
                </>
              ) : splitMode && canEdit ? (
                <div className="flex-1 flex flex-col sm:flex-row">
                  {cssContent && <style dangerouslySetInnerHTML={{ __html: cssContent }} />}
                  <textarea ref={editorRef} value={content} onChange={e => { setContent(e.target.value); setDirty(e.target.value !== original); }} className="flex-1 w-full min-h-[40vh] sm:min-h-0 sm:w-1/2 p-4 resize-none font-mono text-sm bg-transparent border-b sm:border-b-0 sm:border-r border-border focus:outline-none" placeholder="编辑 Markdown..." spellCheck={false} />
                  <div className="flex-1 w-full sm:w-1/2 overflow-y-auto p-4"><MarkdownRenderer content={content} docPath={selected ?? undefined} /></div>
                </div>
              ) : (
                <textarea ref={editorRef} value={content} readOnly={!canEdit} onChange={e => { setContent(e.target.value); setDirty(e.target.value !== original); }} className="flex-1 w-full min-h-[60vh] lg:min-h-0 p-4 resize-none font-mono text-sm bg-transparent focus:outline-none" placeholder={canEdit ? "编辑 Markdown 内容..." : "知识库文档（只读）"} spellCheck={false} />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-faint">
              <div className="text-center px-6">
                <FileText className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
                {notice
                  ? <span className="text-amber-500 text-sm">{notice}</span>
                  : <span>{canEdit ? "选择文件开始编辑" : "选择文件查看内容"}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew === "upload" && canEdit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowNew(null)}>
          <div className="w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">上传文件</h2><button onClick={() => setShowNew(null)} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">目标文件夹</label>
                <select value={uploadFolder} onChange={e => setUploadFolder(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <option value="公共">公共知识库</option>
                  {tree.filter(n => n.name !== "公共知识库").map(n => <option key={n.path} value={n.path}>{n.name}</option>)}
                </select>
              </div>
              <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl p-8 text-center hover:border-sky-400 transition-colors cursor-pointer" onClick={() => fileRef.current?.click()}>
                {uploading ? <div className="flex flex-col items-center gap-2"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /><span className="text-sm text-muted">正在处理...</span></div>
                : <div className="flex flex-col items-center gap-2"><Upload className="h-8 w-8 text-faint" /><span className="text-sm text-muted">点击选择文件</span><span className="text-xs text-faint">支持 PDF、DOCX、MD、TXT（最大50MB）</span></div>}
                <input ref={fileRef} type="file" accept=".pdf,.docx,.md,.txt" onChange={handleUpload} className="hidden" />
              </div>
              {uploadMsg && <div className={`text-sm p-2 rounded-lg ${uploadMsg.startsWith("✅") ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{uploadMsg}</div>}
            </div>
          </div>
        </div>
      )}
      {showNew && showNew !== "upload" && canEdit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowNew(null)}>
          <div className="w-full max-w-sm my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{showNew === "file" ? "新建文档" : "新建目录"}</h2><button onClick={() => setShowNew(null)} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button></div>
            <form onSubmit={e => { e.preventDefault(); handleCreate(); }} className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">名称{showNew === "file" && "（无需 .md 后缀）"}</label><input value={newName} onChange={e => setNewName(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" required autoFocus /></div>
              <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">创建</button>
            </form>
          </div>
        </div>
      )}
      {renameTarget && canEdit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={() => setRenameTarget(null)}>
          <div className="w-full max-w-sm my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">重命名</h2><button onClick={() => setRenameTarget(null)} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button></div>
            <form onSubmit={e => { e.preventDefault(); handleRename(); }} className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">新名称{renameTarget.type === "file" && "（无需扩展名）"}</label><input value={renameNew} onChange={e => setRenameNew(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" required autoFocus /></div>
              <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">重命名</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

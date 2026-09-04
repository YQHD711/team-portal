"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Upload, Download, Trash2, File, Loader2, Globe, Building2 } from "lucide-react";

interface SharedFile { id: number; originalName: string; contentType: string; size: number; visibility: string; department: string | null; uploaderName: string; createdAt: string; }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [visibility, setVisibility] = useState("public");
  const [msg, setMsg] = useState("");
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchFiles = () => api.get<SharedFile[]>("/api/files").then(setFiles).catch(() => {});
  useEffect(() => { fetchFiles(); }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true); setMsg("");
    try {
      const token = localStorage.getItem("token");
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/files/upload?visibility=${visibility}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!res.ok) throw new Error(await res.json().then(j => j.detail).catch(() => "Upload failed"));
      setMsg("✅ 上传成功"); fetchFiles(); if (fileRef.current) fileRef.current.value = "";
    } catch (err) { setMsg("❌ " + (err instanceof Error ? err.message : "上传失败")); }
    finally { setUploading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除？")) return;
    await api.delete(`/api/files/${id}`); fetchFiles();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div><h1 className="text-2xl font-bold">资源共享</h1><p className="text-sm text-muted">上传和下载队内共享文件，支持任意格式（最大 100MB）</p></div>

      <form onSubmit={handleUpload} className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">选择文件</label>
            <input ref={fileRef} type="file" required className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">可见范围</label>
            <select value={visibility} onChange={e => setVisibility(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
              <option value="public">🌐 公开</option>
              <option value="department">🏢 部门</option>
            </select>
          </div>
          <button type="submit" disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "上传中..." : "上传"}
          </button>
        </div>
        {msg && <div className={`text-sm p-2 rounded-lg ${msg.startsWith("✅") ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{msg}</div>}
      </form>

      <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
        {files.length === 0 ? (
          <div className="p-12 text-center text-faint">
            <File className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>暂无共享文件</p>
          </div>
        ) : files.map(f => (
          <div key={f.id} className="flex items-center gap-3 p-4">
            <File className="h-8 w-8 text-faint shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{f.originalName}</div>
              <div className="text-xs text-faint">
                {formatSize(f.size)} · {f.uploaderName} · {new Date(f.createdAt).toLocaleString("zh-CN")}
                <span className="ml-2">{f.visibility === "department" ? "🏢 部门" : "🌐 公开"}</span>
              </div>
            </div>
            <button onClick={async () => {
              const token = localStorage.getItem("token");
              const res = await fetch(`/api/files/${f.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click();
              URL.revokeObjectURL(url);
            }} className="p-2 rounded-lg hover:bg-sky-50 text-sky-600" title="下载"><Download className="h-5 w-5" /></button>
            {isStaff && <button onClick={() => handleDelete(f.id)} className="p-2 rounded-lg hover:bg-red-50 text-danger" title="删除"><Trash2 className="h-5 w-5" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

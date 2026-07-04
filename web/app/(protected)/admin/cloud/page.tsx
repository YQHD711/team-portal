"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Cloud, Upload, Download, Trash2, RefreshCw, HardDrive, Folder, File, Loader2, Key, ExternalLink } from "lucide-react";

interface Quota { total: number; used: number; free: number; }
interface BaiduFile { path: string; name: string; size: number; isDir: boolean; modified: number; }

export default function CloudPage() {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [files, setFiles] = useState<BaiduFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [authed, setAuthed] = useState(true);
  const [authUrl, setAuthUrl] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fetch = () => {
    setLoading(true);
    Promise.all([
      api.get<Quota>("/api/admin/baidu/quota").then(setQuota).catch(() => setAuthed(false)),
      api.get<BaiduFile[]>("/api/admin/baidu/files").then(setFiles).catch(() => setAuthed(false)),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); }, []);

  const getAuthUrl = async () => {
    const data = await api.get<{ url: string }>("/api/admin/baidu/auth-url");
    setAuthUrl(data.url);
  };

  const submitCode = async () => {
    try {
      const data = await api.post<{ message: string }>("/api/admin/baidu/auth-code", { code: authCode });
      setAuthMsg("✅ " + data.message);
      setAuthed(true);
      fetch();
    } catch { setAuthMsg("❌ 授权码无效"); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setMsg("");
    const formData = new FormData(); formData.append("file", file);
    try {
      const token = localStorage.getItem("token");
      const res = await window.fetch("/api/admin/baidu/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) throw new Error("Upload failed");
      setMsg(`✅ ${file.name} 上传成功`);
      fetch();
    } catch { setMsg("❌ 上传失败"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleDownload = async (path: string) => {
    const data = await api.get<{ url: string }>(`/api/admin/baidu/download?path=${encodeURIComponent(path)}`);
    window.open(data.url, "_blank");
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`删除 ${path}？`)) return;
    await window.fetch(`/api/admin/baidu/files?path=${encodeURIComponent(path)}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    fetch();
  };

  const formatSize = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : b < 1073741824 ? `${(b/1048576).toFixed(1)}MB` : `${(b/1073741824).toFixed(2)}GB`;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Cloud className="h-6 w-6 text-sky-500" />云存储</h1><p className="text-sm text-muted mt-1">百度网盘 — 大文件云端存储</p></div>
        <label className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 cursor-pointer shadow-sm">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}上传文件
          <input ref={fileRef} type="file" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {msg && <div className={`text-sm p-2.5 rounded-lg ${msg.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-red-600"}`}>{msg}</div>}

      {/* Auth section */}
      {!authed && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5 space-y-4">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-semibold"><Key className="h-5 w-5" />需要一次性授权</div>
          <p className="text-sm text-amber-700 dark:text-amber-300">百度网盘需要您手动授权后才能使用。只需操作一次，之后自动续期。</p>
          {!authUrl ? (
            <button onClick={getAuthUrl} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">获取授权链接</button>
          ) : (
            <div className="space-y-3">
              <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
                打开授权页面 <ExternalLink className="h-3 w-3" />
              </a>
              <div className="flex gap-2">
                <input value={authCode} onChange={e => setAuthCode(e.target.value)} placeholder="粘贴授权码" className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                <button onClick={submitCode} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600">确认</button>
              </div>
              {authMsg && <div className="text-sm">{authMsg}</div>}
            </div>
          )}
        </div>
      )}

      {/* Quota */}
      {quota && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-3"><HardDrive className="h-4 w-4 text-muted" /><span className="font-semibold text-sm">存储空间</span></div>
          <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all" style={{ width: `${quota.total > 0 ? (quota.used / quota.total * 100) : 0}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted mt-1.5">
            <span>已用 {formatSize(quota.used)}</span>
            <span>共 {formatSize(quota.total)}</span>
          </div>
        </div>
      )}

      {/* File list */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm">文件列表 ({files.length})</span>
          <button onClick={fetch} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4 text-muted" /></button>
        </div>
        <div className="divide-y divide-border">
          {loading ? <div className="p-8 text-center text-muted"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div> :
           files.length === 0 ? <div className="p-8 text-center text-muted"><Cloud className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无文件</div> :
           files.map(f => (
            <div key={f.path} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              {f.isDir ? <Folder className="h-5 w-5 text-amber-500 shrink-0" /> : <File className="h-5 w-5 text-blue-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{f.name}</div>
                <div className="text-xs text-muted">{formatSize(f.size)} · {new Date(f.modified * 1000).toLocaleString("zh-CN")}</div>
              </div>
              {!f.isDir && (
                <div className="flex gap-1">
                  <button onClick={() => handleDownload(f.path)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-500"><Download className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(f.path)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

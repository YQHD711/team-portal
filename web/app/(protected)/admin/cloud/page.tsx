"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Cloud, Upload, Loader2, HardDrive, Database } from "lucide-react";
import CloudAuthPanel from "@/components/admin/cloud/CloudAuthPanel";
import CloudFileList from "@/components/admin/cloud/CloudFileList";
import { formatSize, type BaiduFile, type Quota } from "@/components/admin/cloud/cloudTypes";

const AUTH_KEY = "baidu_authed";

export default function CloudPage() {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [files, setFiles] = useState<BaiduFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentDir, setCurrentDir] = useState("/");
  const [pathStack, setPathStack] = useState<string[]>(["/"]);
  const [msg, setMsg] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null); // null=checking
  const [authUrl, setAuthUrl] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [loadingAuthUrl, setLoadingAuthUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const persistAuth = (value: boolean) => {
    if (value) localStorage.setItem(AUTH_KEY, "1");
    else localStorage.removeItem(AUTH_KEY);
  };

  const fetchDir = useCallback(async (dir: string, addToStack: boolean = true) => {
    setLoading(true);
    setCurrentDir(dir);
    try {
      const token = localStorage.getItem("token");
      const data = await fetch(`/api/admin/baidu/files?dir=${encodeURIComponent(dir)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());
      if (Array.isArray(data)) {
        setFiles(data);
        setAuthed(true);
        persistAuth(true);
        if (addToStack && dir !== pathStack[pathStack.length - 1]) {
          setPathStack(prev => [...prev, dir]);
        }
      } else {
        setFiles([]);
        setAuthed(false);
        persistAuth(false);
      }
    } catch {
      setFiles([]);
      setAuthed(false);
      persistAuth(false);
    }
    setLoading(false);
  }, [pathStack]);

  useEffect(() => {
    // Check previous auth state from localStorage
    const wasAuthed = localStorage.getItem(AUTH_KEY) === "1";

    fetch(`/api/admin/baidu/quota`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    }).then(r => r.json()).then(d => {
      if (d.total > 0) { setQuota(d); setAuthed(true); persistAuth(true); }
      else if (!wasAuthed) { setAuthed(false); }
    }).catch(() => { if (!wasAuthed) setAuthed(false); });
    fetchDir("/", false);
  }, []);

  const navigateTo = (dir: string) => {
    setPathStack(["/"]);
    fetchDir(dir, true);
  };

  const goBack = () => {
    if (pathStack.length > 1) {
      const newStack = pathStack.slice(0, -1);
      setPathStack(newStack);
      fetchDir(newStack[newStack.length - 1], false);
    }
  };

  const getAuthUrl = async () => {
    setLoadingAuthUrl(true);
    try {
      const data = await fetch("/api/admin/baidu/auth-url", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      }).then(r => r.json());
      setAuthUrl(data.url);
    } catch {
      setAuthMsg("❌ 获取授权链接失败，请检查网络连接");
    } finally {
      setLoadingAuthUrl(false);
    }
  };

  const submitCode = async () => {
    setAuthMsg("");
    try {
      const res = await fetch("/api/admin/baidu/auth-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ code: authCode })
      });
      const data = await res.json();
      if (data.success) {
        setAuthMsg("✅ " + data.message);
        setAuthed(true);
        persistAuth(true);
        setAuthCode("");
        fetchDir("/", false);
      } else {
        setAuthMsg("❌ 授权码无效或已过期");
      }
    } catch { setAuthMsg("❌ 授权失败"); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setMsg("");
    setUploadProgress(0);
    const formData = new FormData(); formData.append("file", file);
    try {
      const token = localStorage.getItem("token");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`HTTP ${xhr.status}`)); };
        xhr.onerror = () => reject(new Error("network"));
        xhr.open("POST", `/api/admin/baidu/upload?remoteDir=${encodeURIComponent(currentDir)}`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(formData);
      });
      setMsg(`✅ ${file.name} 上传成功`);
      fetchDir(currentDir, false);
    } catch { setMsg("❌ 上传失败"); }
    finally { setUploading(false); setUploadProgress(0); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = e.dataTransfer.files; if (!files.length) return;
    setUploading(true); setMsg("");
    for (let i = 0; i < files.length; i++) {
      handleUpload({ target: { files: [files[i]] } } as unknown as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const handleDownload = async (file: BaiduFile) => {
    setMsg(`⏳ 正在下载 ${file.name}...`);
    try {
      const token = localStorage.getItem("token");
      const res = await window.fetch(`/api/admin/baidu/download?fsId=${file.fsId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { setMsg("❌ 下载失败"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(`✅ ${file.name} 下载完成`);
    } catch { setMsg("❌ 下载失败"); }
  };

  const handleBackup = async () => {
    setBackingUp(true); setMsg("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/admin/baidu/backup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`✅ ${data.message}`);
        fetchDir(currentDir, false);
      } else {
        setMsg(`❌ ${data.detail || data.title || "备份失败"}`);
      }
    } catch { setMsg("❌ 备份失败"); }
    finally { setBackingUp(false); }
  };

  const copyLink = (file: BaiduFile) => {
    const url = `${window.location.origin}/api/baidu/view/${file.fsId}`;
    navigator.clipboard.writeText(url).then(() => setMsg(`✅ 链接已复制: ${url}`)).catch(() => setMsg(`📋 ${url}`));
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`删除 ${path}？`)) return;
    try {
      const token = localStorage.getItem("token");
      await window.fetch(`/api/admin/baidu/files?path=${encodeURIComponent(path)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` }
      });
      fetchDir(currentDir, false);
    } catch { setMsg("❌ 删除失败"); }
  };

  // Auth check state
  if (authed === null) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Cloud className="h-6 w-6 text-sky-500" />云存储</h1><p className="text-sm text-muted mt-1">百度网盘 — 大文件云端存储</p></div>
        {authed && (
          <div className="flex gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer shadow-sm">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}上传文件
              <input ref={fileRef} type="file" onChange={handleUpload} className="hidden" />
            </label>
            <button onClick={handleBackup} disabled={backingUp} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 shadow-sm">
              {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}创建备份
            </button>
          </div>
        )}
      </div>

      {msg && <div className={`text-sm p-2.5 rounded-lg ${msg.startsWith("✅") ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{msg}</div>}

      {/* Auth section — only show if explicitly not authed */}
      {authed === false && (
        <CloudAuthPanel authUrl={authUrl} authCode={authCode} onAuthCode={setAuthCode}
          authMsg={authMsg} loadingAuthUrl={loadingAuthUrl} onGetAuthUrl={getAuthUrl} onSubmitCode={submitCode} />
      )}

      {/* Quota */}
      {quota && quota.total > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-3"><HardDrive className="h-4 w-4 text-muted" /><span className="font-semibold text-sm">存储空间</span></div>
          <div className="h-3 rounded-full bg-surface-hover overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all" style={{ width: `${quota.total > 0 ? (quota.used / quota.total * 100) : 0}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted mt-1.5">
            <span>已用 {formatSize(quota.used)}</span>
            <span>共 {formatSize(quota.total)}</span>
          </div>
        </div>
      )}

      {/* File list */}
      {authed && (
        <CloudFileList files={files} loading={loading} currentDir={currentDir}
          dragOver={dragOver} uploading={uploading} uploadProgress={uploadProgress}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onNavigate={navigateTo} onGoBack={goBack} onRefresh={() => fetchDir(currentDir, false)}
          onDownload={handleDownload} onDelete={handleDelete} onCopyLink={copyLink} />
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { saveBlob } from "@/lib/download";
import { FileText, Loader2, Upload, Download, Trash2 } from "lucide-react";

export interface LogFile {
  filename: string;
  size: number;
  modified: number;
}

/** 飞控日志文件管理（.tlog / .bin）：上传、下载、管理员删除。 */
export function LogFileList() {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = isAdmin();

  // 初始 loading 为 true，刷新时不重新置位（effect 体内不同步 setState）
  const fetchLogs = () => {
    api
      .get<{ logs: LogFile[] }>("/api/flightlogs")
      .then(r => setLogs(r.logs))
      .catch(() => setError("日志列表加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      await api.post("/api/flightlogs/upload", formData);
      fetchLogs();
    } catch {
      setError("上传失败");
    } finally {
      setUploading(false);
    }
  };

  // 下载必须带 Authorization 头（<a href> 不会带，旧实现直接 401）
  const handleDownload = async (filename: string) => {
    setDownloading(filename);
    setError(null);
    try {
      const blob = await api.download(`/api/flightlogs/${encodeURIComponent(filename)}`, 300000);
      saveBlob(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`确定删除飞行日志「${filename}」吗？此操作不可恢复。`)) return;
    try {
      await api.delete(`/api/flightlogs/${encodeURIComponent(filename)}`);
      fetchLogs();
    } catch {
      setError("删除失败");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-faint" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">飞控日志文件（.tlog / .bin），供队员上传后分析</p>
        <label className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          上传日志
          <input type="file" accept=".tlog,.bin" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {error && <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="rounded-xl border bg-surface divide-y">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-faint">
            <FileText className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>暂无日志文件</p>
            <p className="text-xs mt-1">上传 Pixhawk/ArduPilot 飞控日志进行分析</p>
          </div>
        ) : (
          logs.map(l => (
            <div key={l.filename} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{l.filename}</div>
                <div className="text-xs text-faint mt-0.5">
                  {(l.size / 1024).toFixed(1)} KB · {new Date(l.modified * 1000).toLocaleString("zh-CN")}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleDownload(l.filename)}
                  disabled={downloading === l.filename}
                  className="p-2 hover:bg-surface-hover rounded-lg text-faint disabled:opacity-50"
                  title="下载日志"
                  aria-label={`下载 ${l.filename}`}
                >
                  {downloading === l.filename ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
                {admin && (
                  <button
                    onClick={() => handleDelete(l.filename)}
                    className="p-2 hover:bg-red-50 hover:text-danger rounded-lg text-faint"
                    title="删除日志"
                    aria-label={`删除 ${l.filename}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

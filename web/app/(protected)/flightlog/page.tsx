"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { FileText, Loader2, Upload, Download, Trash2 } from "lucide-react";

interface LogFile { filename: string; size: number; modified: number; }

export default function FlightLogPage() {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchLogs = () => {
    setLoading(true);
    api.get<{logs: LogFile[]}>("/api/flightlogs").then(r => setLogs(r.logs)).catch(()=>{}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try { await api.post("/api/flightlogs/upload", formData); fetchLogs(); } catch { /* ignore */ }
    finally { setUploading(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">飞行日志</h1>
          <p className="text-sm text-zinc-500">飞控日志文件管理（.tlog / .bin）</p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 cursor-pointer">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          上传日志
          <input type="file" accept=".tlog,.bin" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      <div className="rounded-xl border bg-white dark:bg-zinc-900 divide-y">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-zinc-400">
            <FileText className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>暂无日志文件</p>
            <p className="text-xs mt-1">上传 Pixhawk/ArduPilot 飞控日志进行分析</p>
          </div>
        ) : logs.map(l => (
          <div key={l.filename} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium text-sm">{l.filename}</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                {(l.size / 1024).toFixed(1)} KB · {new Date(l.modified * 1000).toLocaleString("zh-CN")}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <a href={`/api/flightlogs/${l.filename}`} download className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400">
                <Download className="h-4 w-4" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

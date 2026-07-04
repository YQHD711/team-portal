"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { FileText, BarChart3, ArrowLeft, Download } from "lucide-react";

interface LogEntry {
  filename: string;
  size: number;
  modified: number;
}

interface LogDetail {
  filename: string;
  size?: number;
  messageCount: number;
  maxAltitude: number | null;
  minAltitude: number | null;
  duration: number | null;
  altitudeSeries: { t: number; alt: number }[];
  note?: string;
}

export default function FlightLogPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    api.get<{ logs: LogEntry[] }>("/api/flightlogs")
      .then((data) => setLogs(data.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    api.get<LogDetail>(`/api/flightlogs/${selected}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selected]);

  const handleSelect = (filename: string) => {
    setSelected(filename);
    setShowList(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">飞行日志</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {logs.length} 个日志文件
          </p>
        </div>
        {/* Mobile back button */}
        {!showList && selected && (
          <button
            onClick={() => { setShowList(true); setSelected(null); }}
            className="lg:hidden inline-flex items-center gap-1 text-sm text-sky-600"
          >
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* File list — hidden on mobile when detail shown */}
        <div className={`${!showList && selected ? "hidden" : "block"} lg:block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden`}>
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium text-sm bg-zinc-50 dark:bg-zinc-950">
            日志文件
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[500px] overflow-y-auto">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4"><div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-3/4 animate-pulse" /></div>
              ))
            ) : logs.length === 0 ? (
              <div className="p-8 text-center">
                <Download className="h-8 w-8 mx-auto mb-2 text-zinc-300" />
                <p className="text-zinc-500 text-sm">暂无飞行日志</p>
                <p className="text-zinc-400 text-xs mt-1">将 .tlog 文件放入 data/flightlogs/</p>
              </div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.filename}
                  onClick={() => handleSelect(log.filename)}
                  className={`w-full text-left p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors ${
                    selected === log.filename ? "bg-sky-50 dark:bg-sky-950 border-l-2 border-sky-500" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
                    <span className="font-medium text-sm truncate">{log.filename}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-zinc-400 space-x-3">
                    <span>{formatSize(log.size)}</span>
                    <span>{new Date(log.modified * 1000).toLocaleString("zh-CN")}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail — full width on mobile */}
        <div className={`${showList && !detail ? "hidden lg:block" : "block"} lg:col-span-2 space-y-4`}>
          {detail ? (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "消息数", value: detail.messageCount.toLocaleString() },
                  { label: "最高高度", value: detail.maxAltitude != null ? `${detail.maxAltitude.toFixed(1)}m` : "—" },
                  { label: "时长", value: detail.duration != null ? `${detail.duration.toFixed(0)}s` : "—" },
                  { label: "大小", value: detail.size ? formatSize(detail.size) : "—" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                    <div className="text-xs text-zinc-400">{s.label}</div>
                    <div className="text-lg font-bold mt-0.5">{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Altitude chart */}
              {detail.altitudeSeries?.length > 0 && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-sky-500" />
                    高度变化
                  </h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={detail.altitudeSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis dataKey="t" tickFormatter={(t) => `${Number(t).toFixed(0)}s`} stroke="#a1a1aa" fontSize={12} />
                      <YAxis stroke="#a1a1aa" fontSize={12} unit="m" />
                      <Tooltip
                        labelFormatter={(t) => `时间: ${Number(t).toFixed(1)}s`}
                        formatter={(v) => [`${Number(v).toFixed(2)}m`, "高度"]}
                      />
                      <Line type="monotone" dataKey="alt" stroke="#0284c7" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {detail.note && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-700 dark:text-blue-300">
                  {detail.note}
                </div>
              )}
            </>
          ) : (
            <div className="hidden lg:flex items-center justify-center h-[400px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-400">
              <div className="text-center">
                <BarChart3 className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
                {logs.length > 0 ? "选择日志查看详情" : "暂无数据"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

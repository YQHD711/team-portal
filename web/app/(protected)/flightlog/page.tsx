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
import { FileText, Download } from "lucide-react";

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

  useEffect(() => {
    api
      .get<{ logs: LogEntry[] }>("/api/flightlogs")
      .then((data) => setLogs(data.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    api
      .get<LogDetail>(`/api/flightlogs/${selected}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selected]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString("zh-CN");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">飞行日志</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* File list */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium text-sm">
            日志文件 ({logs.length})
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[500px] overflow-y-auto">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4">
                  <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4 animate-pulse" />
                </div>
              ))
            ) : logs.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">
                <Download className="h-8 w-8 mx-auto mb-2 text-zinc-300" />
                暂无飞行日志
                <br />
                <span className="text-xs">将 .tlog 文件放入 data/flightlogs/ 目录</span>
              </div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.filename}
                  onClick={() => setSelected(log.filename)}
                  className={`w-full text-left p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${
                    selected === log.filename
                      ? "bg-blue-50 dark:bg-blue-950 border-l-2 border-blue-600"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
                    <span className="font-medium text-sm truncate">{log.filename}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 space-x-3">
                    <span>{formatSize(log.size)}</span>
                    <span>{formatDate(log.modified)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 space-y-4">
          {detail ? (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">消息数</div>
                  <div className="text-lg font-semibold">{detail.messageCount}</div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">最高高度</div>
                  <div className="text-lg font-semibold">
                    {detail.maxAltitude != null ? `${detail.maxAltitude.toFixed(1)}m` : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">飞行时长</div>
                  <div className="text-lg font-semibold">
                    {detail.duration != null ? `${detail.duration.toFixed(0)}s` : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">文件大小</div>
                  <div className="text-lg font-semibold">
                    {detail.size ? formatSize(detail.size) : "—"}
                  </div>
                </div>
              </div>

              {/* Altitude chart */}
              {detail.altitudeSeries && detail.altitudeSeries.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                  <h3 className="font-medium mb-3">高度变化</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={detail.altitudeSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis
                        dataKey="t"
                        tickFormatter={(t) => `${t.toFixed(0)}s`}
                        stroke="#a1a1aa"
                        fontSize={12}
                      />
                      <YAxis stroke="#a1a1aa" fontSize={12} unit="m" />
                      <Tooltip
                        labelFormatter={(t) => `时间: ${Number(t).toFixed(1)}s`}
                        formatter={(v) => [`${Number(v).toFixed(2)}m`, "高度"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="alt"
                        stroke="#2563eb"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {detail.note && (
                <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-700 dark:text-blue-300">
                  {detail.note}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-[400px] rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500">
              {logs.length > 0 ? "请从左侧选择日志文件查看详情" : "暂无数据"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

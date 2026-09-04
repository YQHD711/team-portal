"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Activity, Cpu, MemoryStick, HardDrive, Server, Clock, AlertTriangle, RefreshCw } from "lucide-react";

interface RuntimeStats {
  pid: number;
  processName: string;
  startTime: string;
  uptimeSec: number;
  threads: number;
  handles: number;
  cpuPct: number;
  workingSetMB: number;
  privateBytesMB: number;
  virtualMB: number;
  gc: { heapMB: number; gen0: number; gen1: number; gen2: number };
  system: {
    processorCount: number;
    totalMemoryMB: number;
    isServerGC: boolean;
    os: string;
    dotnetVersion: string;
    machineName: string;
    currentDir: string;
  };
  disk: { totalGB: number; freeGB: number; usedPct: number };
  timestamp: string;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return d > 0 ? `${d}天 ${h}时 ${m}分` : `${h}时 ${m}分 ${s}秒`;
}

function pctColor(pct: number, high = 80, mid = 60): string {
  if (pct >= high) return "text-danger";
  if (pct >= mid) return "text-warning";
  return "text-success";
}

function pctBg(pct: number, high = 80, mid = 60): string {
  if (pct >= high) return "bg-danger";
  if (pct >= mid) return "bg-warning";
  return "bg-success";
}

export default function RuntimeMonitorPage() {
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  const [error, setError] = useState<string>("");
  const [lastFetch, setLastFetch] = useState<number>(0);
  // 组件卸载后阻止 setState — 否则 React 19 Profiler 在已 unmount fiber 上抛 startTime undefined
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchStats = async () => {
    try {
      const data = await api.get<RuntimeStats>("/api/admin/runtime-stats");
      if (!mountedRef.current) return;
      setStats(data);
      setError("");
      setLastFetch(Date.now());
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "获取失败");
    }
  };

  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, 3000); // 3 秒采样一次
    return () => clearInterval(t);
  }, []);

  const memUsedPct = stats ? Math.round(stats.privateBytesMB / stats.system.totalMemoryMB * 100) : 0;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />运行状态监控
          </h1>
          <p className="text-sm text-muted mt-1">进程、内存、GC、线程、磁盘 — 每 3 秒自动刷新</p>
        </div>
        <button onClick={fetchStats} className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />手动刷新
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-4 text-danger text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>无法获取运行数据:{error}(StaffOnly 权限要求 admin / 部长)</div>
        </div>
      )}

      {!stats && !error && (
        <div className="flex items-center justify-center h-32 text-muted text-sm">加载中…</div>
      )}

      {stats && (
        <>
          {/* CPU + 内存两栏主指标 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Cpu className="h-4 w-4" />CPU 使用率
                </div>
                <span className={`text-3xl font-extrabold tabular-nums ${pctColor(stats.cpuPct)}`}>
                  {stats.cpuPct.toFixed(1)}<span className="text-base text-muted ml-1">%</span>
                </span>
              </div>
              <div className="h-2 bg-surface-subtle rounded-full overflow-hidden">
                <div className={`h-full transition-all ${pctBg(stats.cpuPct)}`} style={{ width: `${Math.min(100, stats.cpuPct)}%` }} />
              </div>
              <div className="text-xs text-muted mt-2">{stats.system.processorCount} 核 · {stats.system.isServerGC ? "服务器 GC" : "工作站 GC"}</div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <MemoryStick className="h-4 w-4" />进程内存
                </div>
                <span className={`text-3xl font-extrabold tabular-nums ${pctColor(memUsedPct)}`}>
                  {stats.privateBytesMB.toFixed(0)}<span className="text-base text-muted ml-1">MB</span>
                </span>
              </div>
              <div className="h-2 bg-surface-subtle rounded-full overflow-hidden">
                <div className={`h-full transition-all ${pctBg(memUsedPct)}`} style={{ width: `${Math.min(100, memUsedPct)}%` }} />
              </div>
              <div className="text-xs text-muted mt-2">
                Working Set {stats.workingSetMB.toFixed(0)} MB · Virtual {stats.virtualMB.toFixed(0)} MB · 堆 {stats.gc.heapMB} MB
              </div>
            </div>
          </div>

          {/* 细节卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm text-muted mb-3"><Server className="h-4 w-4" />进程</div>
              <Row label="PID" value={stats.pid.toString()} mono />
              <Row label="名称" value={stats.processName} />
              <Row label="线程" value={stats.threads.toString()} />
              <Row label="句柄" value={stats.handles.toString()} />
              <Row label="启动时间" value={new Date(stats.startTime).toLocaleString("zh-CN")} small />
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm text-muted mb-3"><RefreshCw className="h-4 w-4" />GC</div>
              <Row label="堆内存" value={`${stats.gc.heapMB.toFixed(1)} MB`} mono />
              <Row label="Gen 0 回收" value={stats.gc.gen0.toString()} />
              <Row label="Gen 1 回收" value={stats.gc.gen1.toString()} />
              <Row label="Gen 2 回收" value={stats.gc.gen2.toString()} />
              {stats.gc.gen2 > 100 && (
                <div className="mt-2 text-xs text-warning">⚠ Gen 2 高频,可能存在内存泄漏</div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm text-muted mb-3"><HardDrive className="h-4 w-4" />磁盘</div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xl font-bold tabular-nums ${pctColor(stats.disk.usedPct)}`}>{stats.disk.usedPct}%</span>
                <span className="text-xs text-muted">{stats.disk.freeGB} GB 可用 / {stats.disk.totalGB} GB</span>
              </div>
              <div className="h-2 bg-surface-subtle rounded-full overflow-hidden">
                <div className={`h-full transition-all ${pctBg(stats.disk.usedPct)}`} style={{ width: `${Math.min(100, stats.disk.usedPct)}%` }} />
              </div>
            </div>
          </div>

          {/* 系统信息 */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center gap-2 text-sm text-muted mb-3"><Clock className="h-4 w-4" />系统</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <Row label="主机名" value={stats.system.machineName} inline />
              <Row label="操作系统" value={stats.system.os} inline />
              <Row label=".NET 版本" value={stats.system.dotnetVersion} inline mono />
              <Row label="总内存" value={`${stats.system.totalMemoryMB} MB`} inline />
              <Row label="GC 模式" value={stats.system.isServerGC ? "服务器" : "工作站"} inline />
              <Row label="运行时长" value={formatUptime(stats.uptimeSec)} inline />
              <Row label="当前目录" value={stats.system.currentDir} inline small fullWidth />
              <Row label="上次采样" value={new Date(stats.timestamp).toLocaleString("zh-CN")} inline small />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, mono, small, inline, fullWidth }: {
  label: string; value: string; mono?: boolean; small?: boolean; inline?: boolean; fullWidth?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${inline ? "" : "py-1"} ${fullWidth ? "col-span-full" : ""}`}>
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className={`${small ? "text-xs" : "text-sm"} ${mono ? "font-mono" : ""} truncate text-right`} title={value}>{value}</span>
    </div>
  );
}
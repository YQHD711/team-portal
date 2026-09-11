"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { type CachedFirmware, formatBytes } from "@/lib/firmware";
import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";

interface CachePayload {
  items: CachedFirmware[];
  totalBytes: number;
  maxFileBytes: number;
  root: string;
}

/** 固件落盘缓存的查看与清理（管理员）。 */
export function FirmwareCacheAdmin({ sourceLabel }: { sourceLabel: string }) {
  const [data, setData] = useState<CachePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get<CachePayload>("/api/firmware/cache")
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : "缓存信息读取失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (item: CachedFirmware) => {
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({
      source: item.source,
      vehicle: item.vehicle,
      version: item.version,
      board: item.board,
      fileName: item.fileName,
    });
    try {
      await api.delete(`/api/firmware/cache/item?${q}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("确定清空全部固件缓存吗？下次下载需要重新回源。")) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete("/api/firmware/cache");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-xl border bg-surface">
      <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-medium">
        <HardDrive className="h-4 w-4 text-faint" />
        固件缓存管理
        <span className="text-xs text-faint">
          {loading ? "读取中…" : `${data?.items.length ?? 0} 个文件 · ${formatBytes(data?.totalBytes ?? 0)}`}
        </span>
      </summary>

      <div className="space-y-3 border-t p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-faint">
          <span>单文件上限 {formatBytes(data?.maxFileBytes ?? 0)}</span>
          <span className="truncate">目录 {data?.root}</span>
          <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </button>
          <button
            onClick={clearAll}
            disabled={busy || (data?.items.length ?? 0) === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-danger/40 px-2 py-1 text-danger hover:bg-danger/5 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </button>
        </div>

        {error && <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-faint" />
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <p className="py-4 text-center text-sm text-faint">暂无缓存（{sourceLabel} 未下载过固件）</p>
        ) : (
          <div className="divide-y">
            {data?.items.map(item => (
              <div key={`${item.source}/${item.version}/${item.board}/${item.fileName}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{item.fileName}</div>
                  <div className="text-xs text-faint">
                    {item.source} · {item.version} · {item.board} · {formatBytes(item.size)}
                  </div>
                </div>
                <button
                  onClick={() => remove(item)}
                  disabled={busy}
                  aria-label={`删除缓存 ${item.fileName}`}
                  className="shrink-0 rounded-lg p-2 text-faint hover:bg-red-50 hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

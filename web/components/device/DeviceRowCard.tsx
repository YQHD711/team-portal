"use client";

import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { formatTime, type DeviceRow, type TelemetryRow } from "./deviceAdminTypes";

interface Props {
  device: DeviceRow;
  busy: boolean;
  telemetry?: TelemetryRow[];
  onEdit: () => void;
  onRotate: () => void;
  onToggle: () => void;
  onTelemetry: () => void;
  onRemove: () => void;
}

/** 设备管理页的单行卡片：状态、DeviceKey 复制、操作按钮、可展开遥测。 */
export function DeviceRowCard({ device, busy, telemetry, onEdit, onRotate, onToggle, onTelemetry, onRemove }: Props) {
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* 非安全上下文忽略 */ }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${device.online ? "bg-emerald-500" : "bg-zinc-400"}`} />
            <span className="font-medium">{device.name}</span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-muted">{device.type}</span>
            {!device.enabled && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">已禁用</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
            <code className="rounded bg-surface-hover px-1.5 py-0.5">{device.deviceKey}</code>
            <button onClick={() => copy(device.deviceKey)} className="inline-flex items-center gap-0.5 hover:text-foreground">
              <Copy className="h-3 w-3" />复制
            </button>
            {device.locationCode && <span>库位 {device.locationCode}</span>}
            <span>最后在线 {formatTime(device.lastSeenAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button onClick={onEdit} className="rounded-lg border border-border px-2.5 py-1.5">编辑</button>
          <button onClick={onRotate} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5">
            <RefreshCw className="h-3 w-3" />重置密钥
          </button>
          <button onClick={onToggle} disabled={busy} className="rounded-lg border border-border px-2.5 py-1.5">
            {device.enabled ? "禁用" : "启用"}
          </button>
          <button onClick={onTelemetry} className="rounded-lg border border-border px-2.5 py-1.5">遥测</button>
          <button onClick={onRemove} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-danger/40 px-2.5 py-1.5 text-danger">
            <Trash2 className="h-3 w-3" />删除
          </button>
        </div>
      </div>
      {telemetry && (
        <div className="mt-3 rounded-lg border border-border-subtle bg-background p-2">
          {telemetry.length === 0 ? (
            <div className="p-2 text-xs text-faint">暂无遥测</div>
          ) : (
            <div className="space-y-1">
              {telemetry.map(t => (
                <div key={t.id} className="flex items-start gap-2 text-[11px]">
                  <span className="shrink-0 text-faint">{formatTime(t.createdAt)}</span>
                  <span className="shrink-0 rounded bg-surface-hover px-1 text-muted">{t.kind}</span>
                  <code className="break-all text-faint">{t.payloadJson}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

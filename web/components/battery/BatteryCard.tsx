"use client";

import { Loader2, RotateCcw, ScanLine, Undo2 } from "lucide-react";
import { formatTime, isOverdue, OVERDUE_HOURS, statusMeta, type BatteryItem } from "./batteryTypes";

interface Props {
  battery: BatteryItem;
  busy: boolean;
  onBorrow: (b: BatteryItem) => void;
  onReturn: (b: BatteryItem) => void;
  onEdit?: (b: BatteryItem) => void;
}

/** 台账里的单块电池卡片：状态 + 当前借用人 + 借出/归还按钮。 */
export function BatteryCard({ battery, busy, onBorrow, onReturn, onEdit }: Props) {
  const meta = statusMeta(battery.status);
  const overdue = isOverdue(battery);
  const canBorrow = battery.status === "in_stock";
  const canReturn = battery.status === "borrowed";

  return (
    <div className={`rounded-xl border p-4 bg-surface ${overdue ? "border-danger/50" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-sm text-faint">{battery.code}</div>
          <div className="mt-0.5 truncate text-base font-bold">{battery.model || "未填型号"}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.text}</span>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        {battery.status === "borrowed" ? (
          <div className="flex items-center gap-1.5">
            <Undo2 className="h-3.5 w-3.5 text-muted" />
            <span>{battery.currentBorrower?.username ?? `用户 #${battery.currentBorrowerId}`}</span>
            <span className="text-faint">· {formatTime(battery.borrowedAt)}</span>
          </div>
        ) : (
          <div className="text-faint">在库（可借出）</div>
        )}
        {battery.health && battery.health !== "正常" && (
          <div className="text-xs text-warning">健康度：{battery.health}</div>
        )}
        {overdue && <div className="text-xs font-medium text-danger">已超过 {OVERDUE_HOURS} 小时未归还</div>}
        {battery.notes && <div className="text-xs text-faint">{battery.notes}</div>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {canBorrow && (
          <button
            onClick={() => onBorrow(battery)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
            借出
          </button>
        )}
        {canReturn && (
          <button
            onClick={() => onReturn(battery)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            归还
          </button>
        )}
        {onEdit && (
          <button onClick={() => onEdit(battery)} className="ml-auto text-xs text-sky-600">
            编辑
          </button>
        )}
      </div>
    </div>
  );
}

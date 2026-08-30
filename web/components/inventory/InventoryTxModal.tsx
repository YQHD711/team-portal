import { X } from "lucide-react";
import type { InventoryItem } from "./inventoryTypes";

interface Props {
  item: InventoryItem;
  mode: "checkout" | "checkin" | "consume";
  qty: number;
  onQty: (v: number) => void;
  note: string;
  onNote: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 领用/归还/消耗操作弹窗（数量 + 备注 + 确认） */
export default function InventoryTxModal({ item, mode, qty, onQty, note, onNote, onClose, onSubmit }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">{mode === "consume" ? "消耗登记" : mode === "checkout" ? "领用零件" : "归还零件"}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-faint" /></button>
        </div>
        <p className="text-sm text-muted mb-4">
            {item.name} · {item.grade}级 · 库存 {item.quantity}
            {mode === "consume" && <span className="block text-purple-500 text-xs mt-1">C级耗材，直接消耗不入归还流程。批量消耗请通过盘点补货。</span>}
          </p>
        <div className="space-y-3">
          <div><label className="block text-sm font-medium mb-1">数量</label><input type="number" min={1} max={mode === "checkin" ? 999 : item.quantity} value={qty} onChange={e => onQty(Number(e.target.value))} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" /></div>
          <div><label className="block text-sm font-medium mb-1">{mode === "consume" ? "用途" : "备注"}</label><input value={note} onChange={e => onNote(e.target.value)} placeholder={mode === "consume" ? "用了做什么..." : "借用人/用途..."} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" /></div>
          <button onClick={onSubmit} className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white ${mode === "consume" ? "bg-primary hover:bg-accent-hover" : mode === "checkout" ? "bg-warning hover:bg-amber-600" : "bg-emerald-500 hover:bg-emerald-600"}`}>
            {mode === "consume" ? `确认消耗 ${qty} 个` : mode === "checkout" ? `确认领用 ${qty} 个` : `确认归还 ${qty} 个`}
          </button>
        </div>
      </div>
    </div>
  );
}

import { X } from "lucide-react";
import type { InventoryItem, Transaction } from "./inventoryTypes";

interface Props {
  item: InventoryItem;
  history: Transaction[];
  onClose: () => void;
}

/** 零件出入库记录面板 */
export default function InventoryHistoryPanel({ item, history, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl p-6 w-full max-w-md max-h-[70vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">出入库记录 — {item.name}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-faint" /></button>
        </div>
        {history.length === 0 ? <p className="text-sm text-muted text-center py-4">暂无记录</p> :
          <div className="space-y-2">
            {history.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-subtle text-sm">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${t.type === "checkout" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{t.type === "checkout" ? "借出" : "归还"}</span>
                <span className="font-medium">{t.quantity}</span>
                <span className="text-muted flex-1">{t.userName}{t.note ? ` · ${t.note}` : ""}</span>
                <span className="text-xs text-faint">{new Date(t.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}

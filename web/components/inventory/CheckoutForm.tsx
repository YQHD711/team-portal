import { Plus, Search, X } from "lucide-react";
import type { Item } from "./checkoutTypes";

interface Props {
  showNew: boolean;
  onOpen: () => void;
  onClose: () => void;
  allItems: Item[];
  itemSearch: string;
  onItemSearch: (v: string) => void;
  newForm: { itemId: number; quantity: number; note: string };
  setNewForm: React.Dispatch<React.SetStateAction<{ itemId: number; quantity: number; note: string }>>;
  onSubmit: () => void;
}

/** 新建领用申请（搜索物料 → 选择 → 数量/备注 → 提交） */
export default function CheckoutForm({ showNew, onOpen, onClose, allItems, itemSearch, onItemSearch, newForm, setNewForm, onSubmit }: Props) {
  const filtered = allItems.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.category.toLowerCase().includes(itemSearch.toLowerCase())
  );

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      {!showNew ? (
        <button onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600 shadow-sm">
          <Plus className="h-4 w-4" />新建领用申请
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">新建领用申请</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input type="text" placeholder="搜索物料..." value={itemSearch}
              onChange={e => onItemSearch(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-9 pr-3 py-2 text-sm" />
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y dark:border-zinc-700">
            {filtered.slice(0, 20).map(item => (
              <button key={item.id}
                onClick={() => setNewForm({ ...newForm, itemId: item.id })}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${newForm.itemId === item.id ? "bg-sky-50 dark:bg-sky-950 ring-1 ring-sky-300" : ""}`}>
                <div>
                  <span className="font-medium">{item.name}</span>
                  <span className="text-xs text-zinc-400 ml-2">{item.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${item.grade === "A" ? "bg-red-100 text-red-700" : item.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>{item.grade}</span>
                  <span className="text-xs text-zinc-400">库存: {item.quantity}</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">无匹配物料</div>}
          </div>
          <div className="flex gap-2">
            <input type="number" min={1} max={allItems.find(i => i.id === newForm.itemId)?.quantity || 1}
              value={newForm.quantity} onChange={e => setNewForm({ ...newForm, quantity: Number(e.target.value) })}
              className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
            <input type="text" placeholder="用途备注（选填）" value={newForm.note}
              onChange={e => setNewForm({ ...newForm, note: e.target.value })}
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
            <button onClick={onSubmit} disabled={!newForm.itemId}
              className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed">
              提交申请
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

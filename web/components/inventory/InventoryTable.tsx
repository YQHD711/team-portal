import { Package, Minus, Plus as PlusIcon, History, Pencil, Trash2 } from "lucide-react";
import { LOW_THRESHOLD, statusOpts, type InventoryItem } from "./inventoryTypes";

interface Props {
  items: InventoryItem[];
  loading: boolean;
  role: string;
  onTake: (item: InventoryItem) => void;   // 领用(C/B级走审批)或消耗(C级直接扣库存)
  onReturn: (item: InventoryItem) => void; // 归还
  onHistory: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}

/** 零件列表（移动端卡片 + 桌面表格），含领用/归还/记录/编辑/删除操作 */
export default function InventoryTable({ items, loading, role, onTake, onReturn, onHistory, onEdit, onDelete }: Props) {
  const isStaff = role === "admin" || role === "部长";

  return (
    <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-surface">
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-border">
        {loading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-3"><div className="h-16 shimmer rounded-lg" /></div>) :
         items.length === 0 ? <div className="p-8 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2" />暂无零件</div> :
         items.map(item => (
          <div key={item.id} className={`p-3 ${item.quantity < LOW_THRESHOLD ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-medium text-sm">{item.name}</div>
                <div className="text-xs text-muted">{item.category} · {item.locationCode || "—"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onTake(item)}
                  className={`p-1 rounded-lg ${item.grade === "C" ? "hover:bg-purple-50 dark:hover:bg-purple-950 text-purple-500" : "hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500"}`}
                  title={item.grade === "C" ? "消耗" : "领用"}><Minus className="h-4 w-4" /></button>
                <button onClick={() => onReturn(item)} className={`p-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500 ${item.grade === "C" ? "hidden" : ""}`} title="归还"><PlusIcon className="h-4 w-4" /></button>
                <button onClick={() => onHistory(item)} className="p-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-4 w-4" /></button>
                {isStaff && <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg hover:bg-surface-hover"><Pencil className="h-4 w-4 text-muted" /></button>}
                {isStaff && <button onClick={() => onDelete(item)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950"><Trash2 className="h-4 w-4 text-red-400" /></button>}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-faint"}`}>{statusOpts.find(s => s.value === item.status)?.label || item.status}</span>
              <span className={`text-lg font-bold ${item.quantity === 0 ? "text-danger" : item.quantity < LOW_THRESHOLD ? "text-amber-500" : ""}`}>{item.quantity}</span>
            </div>
          </div>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-surface-subtle"><th className="px-4 py-3 text-left font-medium text-muted">名称</th><th className="px-4 py-3 text-left font-medium text-muted hidden sm:table-cell">分类</th><th className="px-4 py-3 text-center font-medium text-muted w-12">等级</th><th className="px-4 py-3 text-right font-medium text-muted">数量</th><th className="px-4 py-3 text-left font-medium text-muted hidden md:table-cell">位置</th><th className="px-4 py-3 text-left font-medium text-muted">状态</th><th className="px-4 py-3 text-right font-medium text-muted">操作</th></tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 shimmer rounded" /></td>)}</tr>) :
             items.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无零件，点击"添加零件"开始</td></tr> :
             items.map(item => (
              <tr key={item.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-950 ${item.quantity < LOW_THRESHOLD ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                <td className="px-4 py-3"><span className="font-medium">{item.name}</span><span className="block text-xs text-faint sm:hidden">{item.category}</span></td>
                <td className="px-4 py-3 text-muted hidden sm:table-cell">{item.category}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${item.grade === "A" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : item.grade === "B" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint"}`}>{item.grade || "C"}</span>
                </td>
                <td className={`px-4 py-3 text-right font-medium tabular-nums ${item.quantity === 0 ? "text-danger" : item.quantity < LOW_THRESHOLD ? "text-warning" : ""}`}>{item.quantity}</td>
                <td className="px-4 py-3 text-muted hidden md:table-cell text-xs font-mono">{item.locationCode || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-faint"}`}>
                    {statusOpts.find(s => s.value === item.status)?.label || item.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onTake(item)}
                      className={`p-1 rounded ${item.grade === "C" ? "hover:bg-purple-50 dark:hover:bg-purple-950 text-purple-500" : "hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500"}`}
                      title={item.grade === "C" ? "消耗" : "领用"}><Minus className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onReturn(item)} className={`p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500 ${item.grade === "C" ? "hidden" : ""}`} title="归还"><PlusIcon className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onHistory(item)} className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-3.5 w-3.5" /></button>
                    {isStaff && <>
                      <button onClick={() => onEdit(item)} className="p-1 rounded hover:bg-surface-hover text-faint hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => onDelete(item)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

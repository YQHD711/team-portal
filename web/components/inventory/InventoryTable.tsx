import { Package, Minus, Plus as PlusIcon, History, Pencil, Trash2, QrCode } from "lucide-react";
import { statusOpts, type InventoryItem } from "./inventoryTypes";
import { useLowStock } from "./LowStockProvider";
import LocationLink from "./LocationLink";

interface Props {
  items: InventoryItem[];
  loading: boolean;
  role: string;
  onTake: (item: InventoryItem) => void;   // 领用(C/B级走审批)或消耗(C级直接扣库存)
  onLabel: (item: InventoryItem) => void;  // 物料标签（二维码）
  onReturn: (item: InventoryItem) => void; // 归还
  onHistory: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
  /** 批量打印多选（仅 staff 传入；不传则不渲染复选框） */
  selectable?: boolean;
  selectedIds?: ReadonlySet<number>;
  onToggleSelect?: (id: number) => void;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
}

/** 零件列表（移动端卡片 + 桌面表格），含领用/归还/记录/编辑/删除操作 */
export default function InventoryTable({
  items, loading, role, onTake, onLabel, onReturn, onHistory, onEdit, onDelete,
  selectable = false, selectedIds, onToggleSelect, allSelected = false, onToggleSelectAll,
}: Props) {
  const isStaff = role === "admin" || role === "部长";
  // 改物料：管理员 + 部长（物料是队内共享资源，部长可订正字段，也能在布局页归位）
  // 删物料：仅管理员（改错了能改回来，删了连带领用/盘点记录一起没了）
  const isAdmin = role === "admin";
  const { threshold } = useLowStock();

  return (
    <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-surface">
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-border">
        {loading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-3"><div className="h-16 shimmer rounded-lg" /></div>) :
         items.length === 0 ? <div className="p-8 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2" />暂无零件</div> :
         items.map(item => (
          <div key={item.id} className={`p-3 ${isStaff && item.quantity < threshold ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
            {selectable && (
              <label className="mb-1.5 inline-flex min-h-10 cursor-pointer items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="h-4 w-4" data-testid={`select-item-m-${item.id}`}
                  aria-label={`选择 ${item.name}`}
                  checked={selectedIds?.has(item.id) ?? false}
                  onChange={() => onToggleSelect?.(item.id)} />
                选择打印
              </label>
            )}
            {/* 主信息：名称/分类/库位 + 数量状态。文字列 min-w-0 允许收缩，
                长物料名（一串无反斜杠的英文/编号）也不会把整行顶出卡片。 */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm break-words [overflow-wrap:anywhere]">{item.name}</div>
                {item.code && <div className="text-xs font-mono text-faint break-all">{item.code}</div>}
                <div className="mt-0.5 text-xs text-muted break-words">
                  {item.category} · <LocationLink locationCode={item.locationCode} item={item.code || item.id} testId={`item-location-m-${item.id}`} />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-lg font-bold leading-none ${isStaff ? (item.quantity === 0 ? "text-danger" : item.quantity < threshold ? "text-amber-500" : "") : ""}`}>{item.quantity}</span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-faint"}`}>{statusOpts.find(s => s.value === item.status)?.label || item.status}</span>
              </div>
            </div>
            {/* 操作行单独一行并允许折行：原来 6 个图标塞在标题右侧，40px 触控区会把卡片顶破 */}
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle pt-2">
              <button onClick={() => onTake(item)} disabled={item.status === "broken"} aria-label={item.status === "broken" ? "已报损，不能领用" : item.grade === "C" ? "消耗" : "领用"}
                className={`tap-sm p-2 rounded-lg ${item.status === "broken" ? "text-faint cursor-not-allowed opacity-40" : item.grade === "C" ? "hover:bg-purple-50 dark:hover:bg-purple-950 text-purple-500" : "hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500"}`}
                title={item.status === "broken" ? "已报损，不能领用" : item.grade === "C" ? "消耗" : "领用"}><Minus className="h-4 w-4" /></button>
              <button onClick={() => onReturn(item)} aria-label="归还" className={`tap-sm p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500 ${item.grade === "C" ? "hidden" : ""}`} title="归还"><PlusIcon className="h-4 w-4" /></button>
              <button onClick={() => onHistory(item)} aria-label="领用记录" className="tap-sm p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-4 w-4" /></button>
              {item.code && <button onClick={() => onLabel(item)} aria-label="物料标签（二维码）" className="tap-sm p-2 rounded-lg hover:bg-surface-hover text-muted" title="物料标签（二维码）"><QrCode className="h-4 w-4" /></button>}
              {isStaff && <button onClick={() => onEdit(item)} aria-label="编辑物料" title="编辑物料" className="tap-sm p-2 rounded-lg hover:bg-surface-hover"><Pencil className="h-4 w-4 text-muted" /></button>}
              {isAdmin && <button onClick={() => onDelete(item)} aria-label="删除物料" title="删除物料" className="tap-sm p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950"><Trash2 className="h-4 w-4 text-red-400" /></button>}
            </div>
          </div>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-surface-subtle">
            {selectable && (
              <th className="w-10 px-4 py-3 text-left">
                <input type="checkbox" className="h-4 w-4" data-testid="select-all-items"
                  aria-label="全选物料" checked={allSelected}
                  onChange={() => onToggleSelectAll?.()} />
              </th>
            )}
            <th className="px-4 py-3 text-left font-medium text-muted">名称</th><th className="px-4 py-3 text-left font-medium text-muted hidden sm:table-cell">分类</th><th className="px-4 py-3 text-center font-medium text-muted w-12">等级</th><th className="px-4 py-3 text-right font-medium text-muted">数量</th><th className="px-4 py-3 text-left font-medium text-muted hidden md:table-cell">位置</th><th className="px-4 py-3 text-left font-medium text-muted">状态</th><th className="px-4 py-3 text-right font-medium text-muted">操作</th></tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}>{Array.from({ length: selectable ? 8 : 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 shimmer rounded" /></td>)}</tr>) :
             items.length === 0 ? <tr><td colSpan={selectable ? 8 : 7} className="px-4 py-12 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无零件，点击"添加零件"开始</td></tr> :
             items.map(item => (
              <tr key={item.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-950 ${isStaff && item.quantity < threshold ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                {selectable && (
                  <td className="px-4 py-3">
                    <input type="checkbox" className="h-4 w-4" data-testid={`select-item-${item.id}`}
                      aria-label={`选择 ${item.name}`}
                      checked={selectedIds?.has(item.id) ?? false}
                      onChange={() => onToggleSelect?.(item.id)} />
                  </td>
                )}
                <td className="px-4 py-3"><span className="font-medium">{item.name}</span>{item.code && <span className="block text-xs font-mono text-faint">{item.code}</span>}<span className="block text-xs text-faint sm:hidden">{item.category}</span></td>
                <td className="px-4 py-3 text-muted hidden sm:table-cell">{item.category}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${item.grade === "A" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : item.grade === "B" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint"}`}>{item.grade || "C"}</span>
                </td>
                <td className={`px-4 py-3 text-right font-medium tabular-nums ${isStaff ? (item.quantity === 0 ? "text-danger" : item.quantity < threshold ? "text-warning" : "") : ""}`}>{item.quantity}</td>
                <td className="px-4 py-3 text-muted hidden md:table-cell text-xs font-mono">
                  <LocationLink locationCode={item.locationCode} item={item.code || item.id} testId={`item-location-${item.id}`} />
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-faint"}`}>
                    {statusOpts.find(s => s.value === item.status)?.label || item.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onTake(item)} disabled={item.status === "broken"}
                      className={`p-1 rounded ${item.status === "broken" ? "text-faint cursor-not-allowed opacity-40" : item.grade === "C" ? "hover:bg-purple-50 dark:hover:bg-purple-950 text-purple-500" : "hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500"}`}
                      title={item.status === "broken" ? "已报损，不能领用" : item.grade === "C" ? "消耗" : "领用"}><Minus className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onReturn(item)} className={`p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500 ${item.grade === "C" ? "hidden" : ""}`} title="归还"><PlusIcon className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onHistory(item)} className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-3.5 w-3.5" /></button>
                    {item.code && <button onClick={() => onLabel(item)} className="p-1 rounded hover:bg-surface-hover text-muted" title="物料标签（二维码）"><QrCode className="h-3.5 w-3.5" /></button>}
                    {isStaff && <button onClick={() => onEdit(item)} title="编辑物料" className="p-1 rounded hover:bg-surface-hover text-faint hover:text-sky-600"><Pencil className="h-4 w-4" /></button>}
                    {isAdmin && <button onClick={() => onDelete(item)} title="删除物料" className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-danger/70 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
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

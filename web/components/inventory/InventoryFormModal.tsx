import { X } from "lucide-react";
import { categoryOpts, type Department, type InventoryItem, type InventoryFormState } from "./inventoryTypes";
import { LocationPicker } from "./LocationPicker";
import type { RoomLayoutOption } from "./locationOptions";

interface Props {
  editItem: InventoryItem | null;
  form: InventoryFormState;
  setForm: React.Dispatch<React.SetStateAction<InventoryFormState>>;
  /** 房间及其平面图（/api/storage/layouts），用于「室 → 元素 → 层 → 位」联动选择 */
  rooms: RoomLayoutOption[];
  fallbackRooms: string[];
  onLocationCode: (code: string) => void;
  departments: Department[];
  calcGrade: (price: number) => string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** 添加/编辑零件弹窗（表单 + 库位编码联动选择） */
export default function InventoryFormModal({ editItem, form, setForm, rooms, fallbackRooms, onLocationCode, departments, calcGrade, onClose, onSubmit }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editItem ? "编辑零件" : "添加零件"}</h2><button onClick={onClose} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button></div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">名称</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editItem} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">分类</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">选择分类...</option>
                {categoryOpts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {!editItem && <div><label className="block text-sm font-medium mb-1">初始数量</label><input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /><p className="text-xs text-faint mt-1">仅新建时填写，后续通过盘点或采购入库调整</p></div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">等级</label>
              <select value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })}
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-bold ${
                  form.grade === "A" ? "border-red-300 bg-red-50 dark:bg-red-950 text-red-700" :
                  form.grade === "B" ? "border-amber-300 bg-amber-50 dark:bg-amber-950 text-amber-700" :
                  "border-zinc-300 bg-surface"}`}>
                <option value="A">A — 关键管控 (≥¥1000)</option>
                <option value="B">B — 常规管理 (¥100-999)</option>
                <option value="C">C — 自主领用 (&lt;¥100)</option>
              </select>
            </div>
            <div><label className="block text-sm font-medium mb-1">单价 ¥</label>
              <input type="number" step="0.01" min="0"
                value={form.unitPrice}
                onChange={e => {
                  const price = Number(e.target.value);
                  setForm({ ...form, unitPrice: price, grade: price > 0 ? calcGrade(price) : form.grade });
                }}
                placeholder="填写后自动判定等级"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              {form.unitPrice > 0 && (
                <p className="text-xs text-faint mt-1">自动判定: {calcGrade(form.unitPrice)} 级 {calcGrade(form.unitPrice) !== form.grade ? "(已手动修改)" : ""}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">归属部门</label><select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"><option value={0}>— 无 —</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">项目标签</label><input value={form.projectTag} onChange={e => setForm({ ...form, projectTag: e.target.value })} placeholder="如: CADC2026" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              库位编码 <span className="text-xs text-faint">（选房间与货架/柜子/工作台后自动生成，与平面图一致）</span>
            </label>
            <LocationPicker rooms={rooms} fallbackRooms={fallbackRooms}
              value={form.locationCode} onChange={onLocationCode} />
          </div>
          <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">{editItem ? "保存修改" : "添加零件"}</button>
        </form>
      </div>
    </div>
  );
}

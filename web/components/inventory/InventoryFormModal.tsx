import { X } from "lucide-react";
import { categoryOpts, type Department, type InventoryItem, type InventoryFormState } from "./inventoryTypes";

interface Props {
  editItem: InventoryItem | null;
  form: InventoryFormState;
  setForm: React.Dispatch<React.SetStateAction<InventoryFormState>>;
  locRoom: string; setLocRoom: (v: string) => void;
  locCabinet: string; setLocCabinet: (v: string) => void;
  locShelf: string; setLocShelf: (v: string) => void;
  locPos: string; setLocPos: (v: string) => void;
  roomOpts: string[];
  departments: Department[];
  buildLocCode: (room: string, cab: string, shelf: string, pos: string) => string;
  calcGrade: (price: number) => string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** 添加/编辑零件弹窗（表单 + 库位编码四段录入） */
export default function InventoryFormModal({ editItem, form, setForm, locRoom, setLocRoom, locCabinet, setLocCabinet, locShelf, setLocShelf, locPos, setLocPos, roomOpts, departments, buildLocCode, calcGrade, onClose, onSubmit }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editItem ? "编辑零件" : "添加零件"}</h2><button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button></div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">名称</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editItem} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">分类</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="">选择分类...</option>
                {categoryOpts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {!editItem && <div><label className="block text-sm font-medium mb-1">初始数量</label><input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /><p className="text-xs text-zinc-400 mt-1">仅新建时填写，后续通过盘点或采购入库调整</p></div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">等级</label>
              <select value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })}
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-bold ${
                  form.grade === "A" ? "border-red-300 bg-red-50 dark:bg-red-950 text-red-700" :
                  form.grade === "B" ? "border-amber-300 bg-amber-50 dark:bg-amber-950 text-amber-700" :
                  "border-zinc-300 bg-white dark:bg-zinc-950"}`}>
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
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              {form.unitPrice > 0 && (
                <p className="text-xs text-zinc-400 mt-1">自动判定: {calcGrade(form.unitPrice)} 级 {calcGrade(form.unitPrice) !== form.grade ? "(已手动修改)" : ""}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">归属部门</label><select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: Number(e.target.value) })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"><option value={0}>— 无 —</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">项目标签</label><input value={form.projectTag} onChange={e => setForm({ ...form, projectTag: e.target.value })} placeholder="如: CADC2026" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">库位编码 <span className="text-zinc-400 text-xs">室-架-层-位</span></label>
            <div className="grid grid-cols-4 gap-1.5">
              <select value={locRoom} onChange={e => setLocRoom(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="">室</option>
                {roomOpts.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input type="number" min={1} max={99} value={locCabinet} onChange={e => setLocCabinet(e.target.value)}
                placeholder="架" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <input type="number" min={1} max={9} value={locShelf} onChange={e => setLocShelf(e.target.value)}
                placeholder="层" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <input type="number" min={1} max={99} value={locPos} onChange={e => setLocPos(e.target.value)}
                placeholder="位" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            {(locRoom || locCabinet) && <p className="text-xs text-zinc-400 mt-1">编码: {buildLocCode(locRoom, locCabinet, locShelf, locPos) || "—"}</p>}
          </div>
          <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600">{editItem ? "保存修改" : "添加零件"}</button>
        </form>
      </div>
    </div>
  );
}

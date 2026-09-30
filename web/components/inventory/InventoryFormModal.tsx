import { X } from "lucide-react";
import QRCode from "react-qr-code";
import { categoryOpts, type InventoryItem, type InventoryFormState } from "./inventoryTypes";
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
  calcGrade: (price: number) => string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  /** 改物料编码（会自动转大写） */
  onCode: (code: string) => void;
  /** 按 分类+物品号+型号+年份 调后端取下一个序号 */
  onGenerateCode: () => void;
  genCodeLoading: boolean;
  codeError: string;
  /** 自动生号时后端一并返回的短链：有值就当场把二维码与短链显示出来 */
  generatedShortUrl: string;
}

/** 添加/编辑零件弹窗（表单 + 库位编码联动选择） */
export default function InventoryFormModal({ editItem, form, setForm, rooms, fallbackRooms, onLocationCode, calcGrade, onClose, onSubmit, onCode, onGenerateCode, genCodeLoading, codeError, generatedShortUrl }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editItem ? "编辑零件" : "添加零件"}</h2><button onClick={onClose} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button></div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">名称</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editItem} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">分类</label>
              <select aria-label="分类" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
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
          {form.unitPrice <= 0 && (
            <div data-testid="unit-price-warning"
              className={`rounded-lg border-l-4 px-3 py-2 text-xs leading-relaxed ${
                form.grade === "C"
                  ? "border-danger bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                  : "border-warning bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              }`}>
              {form.grade === "C" ? (
                <>⚠️ <strong>单价为空，且等级是 C</strong>：C 级物料<strong>无需审批、可被任何人自助领走</strong>，
                  归还也没有强制留痕。贵重件请填真实单价（≥¥1000 自动判 A 级），或手动把等级改成 B 级以上。</>
              ) : (
                <>⚠️ <strong>单价为空</strong>：无法计入"库存总价值"，也无法自动校验等级。
                  建议补填实际采购价（见《物料管理规范》第 3 节）。</>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                物料编码 <span className="text-xs text-faint">（可留空，之后再贴标）</span>
              </label>
              <input value={form.code} onChange={e => onCode(e.target.value.toUpperCase())}
                placeholder="如 BAT-LIPO-6S3300MAH-2026-0007"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-muted">
              物料是<strong>队内共享</strong>的，不再挂"归属部门"。领用审批看的是<strong>申请人</strong>的部门，与物料无关（见规范 §8.1）。
            </div>
          </div>

          {/* 自动生号：系统只能确定前缀（按分类）、年份、序号，物品号与型号必须由人给 */}
          <div className="rounded-lg border border-border bg-surface-subtle p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">不会填？让系统拼一个：</span>
              <button type="button" onClick={onGenerateCode} disabled={genCodeLoading}
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-hover disabled:opacity-50">
                {genCodeLoading ? "生成中..." : "自动生成编码"}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <input aria-label="物品号" value={form.codeItemNo} placeholder="物品号 如 LIPO"
                onChange={e => setForm({ ...form, codeItemNo: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <input aria-label="型号" value={form.codeModel} placeholder="型号 如 6S3300MAH"
                onChange={e => setForm({ ...form, codeModel: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <input aria-label="采购年份" value={form.codeYear} placeholder="年份"
                onChange={e => setForm({ ...form, codeYear: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            {codeError && <p className="text-xs text-danger">{codeError}</p>}
            {generatedShortUrl && (
              <div data-testid="generated-qr" className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2">
                <div className="shrink-0 rounded bg-white p-1">
                  <QRCode value={generatedShortUrl} size={64} level="M" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted">二维码与短链已生成</div>
                  <div className="break-all font-mono text-[10px] text-faint">{generatedShortUrl}</div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              库位编码 <span className="text-xs text-faint">（<strong>可以留空</strong>：新到的物料可以先不归位，之后再补）</span>
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

"use client";

/** 元素属性弹窗：cm 位置/尺寸/旋转 + 按类型的「行 × 列」格位；调用方按 element.id 加 key，切换元素时整体重挂载 */
import { useState } from "react";
import { X } from "lucide-react";
import { CellGrid, canUnderTable } from "./CellGrid";
import { hasUnderTable, underTableImpact, withUnderTable } from "./tableZones";
import type { ItemElement, ItemType, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { ELEMENT_DEFS, ITEM_TYPES, cellAxes, cellSummary } from "./layoutTypes";
import { COLS_MAX, MIN_ELEMENT_CM, ROOM_MAX_CM, ROWS_MAX } from "./layoutUnits";
import { POS_PRESETS, SIZE_PRESETS } from "./layoutPresets";
import { LengthPresets, NumField, PresetButtons, inputCls } from "./PropertyFields";
import { NestActionsButton } from "./NestActionsButton";

interface PropertyDialogProps {
  element: PosElement | ItemElement;
  roomCode: string;
  /** 物料（格位图里显示每个格子的占用数）；缺省 [] 以兼容既有调用/测试 */
  items?: MaterialItem[];
  onSave: (el: PosElement | ItemElement) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** @deprecated 正视详情已合并进本面板（①②），保留字段仅为兼容既有调用 */
  onDetail?: (el: ItemElement) => void;
  /** 容器归属（移入/移出容器）：选中元素的所有操作都收进这个面板，不再裸放工具栏 */
  nest?: { layout: RoomLayout; selectedHasParent: boolean; onNest: (parentId: string) => void; onDetach: () => void };
}

type Draft = PosElement | ItemElement;

function kindOf(el: PosElement): "wall" | "door" | "window" {
  if (el.id.startsWith("door-")) return "door";
  if (el.id.startsWith("window-")) return "window";
  return "wall";
}

export function PropertyDialog({ element, roomCode, items, onSave, onDelete, onClose, nest }: PropertyDialogProps) {
  const mats = items ?? [];   // ① 内嵌格位图要显示占用数；未传时退化为空（不影响属性编辑）
  const [draft, setDraft] = useState<Draft>(() => ({ ...element }));
  const isItem = "type" in draft;
  const def = ELEMENT_DEFS[isItem ? draft.type : kindOf(draft)];
  const patch = (p: Partial<ItemElement>) => setDraft(d => ({ ...d, ...p }) as Draft);

  const save = () => {
    const name = isItem ? draft.name.trim() || def.label : "";
    const locCode = isItem ? (draft.locCode || "").trim() : "";
    onSave({ ...draft, ...(isItem ? { name, locCode } : {}), w: Math.max(MIN_ELEMENT_CM, draft.w), h: Math.max(MIN_ELEMENT_CM, draft.h) });
  };

  const item = isItem ? draft : null;
  const axes = item ? cellAxes(item) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: def.color }} />
            {def.label}属性
          </h3>
          <button onClick={onClose} aria-label="关闭" className="rounded p-1 hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        {item ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">名称</span>
                <input value={item.name} onChange={e => patch({ name: e.target.value })} placeholder={def.label} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">类型</span>
                <select value={item.type} onChange={e => patch({ type: e.target.value as ItemType })} className={inputCls}>
                  {ITEM_TYPES.map(t => <option key={t} value={t}>{ELEMENT_DEFS[t].label}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                库位编码 <span className="text-xs text-faint">（如 {roomCode}-A，物料按此前缀挂载）</span>
              </span>
              <input value={item.locCode ?? ""} onChange={e => patch({ locCode: e.target.value })} placeholder={`${roomCode}-A`} className={inputCls} />
            </label>

            {nest && (
              <div className="rounded-xl border border-border bg-surface-subtle p-3">
                <div className="mb-2 text-xs font-semibold text-muted">容器归属（把本元素放进某个容器）</div>
                <NestActionsButton layout={nest.layout} selected={item.id} selectedHasParent={nest.selectedHasParent} onNest={nest.onNest} onDetach={nest.onDetach} />
              </div>
            )}

            <div className="rounded-xl border border-border bg-surface-subtle p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">格位划分 · {cellSummary(item)}</span>
                <span className="text-[10px] text-faint">1 × 1 = 整体挂载</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label={`行数（${axes?.rowLabel}）`} value={item.rows ?? 1} min={1} max={ROWS_MAX}
                  onCommit={v => patch({ rows: v })} />
                <NumField label={`列数（${axes?.colLabel}）`} value={item.cols ?? 1} min={1} max={COLS_MAX}
                  onCommit={v => patch({ cols: v })} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">{def.hint}</p>
            </div>

            {/* ①② 桌下 = 真正多一层：按钮 + 立即预览（改的是草稿，保存后生效、可 Ctrl+Z 撤销） */}
            {canUnderTable(item) && (
              <button type="button" data-testid="toggle-under-table"
                onClick={() => {
                  const next = !hasUnderTable(item);
                  if (!next) { const imp = underTableImpact(item, mats); if (!confirm(`桌下 ${imp.cells} 个库位、${imp.items} 件物料将不可见/不可用，确定关闭？`)) return; }
                  patch(withUnderTable(item, next) as Partial<ItemElement>);
                }}
                className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {hasUnderTable(item) ? "关闭桌下存储" : "＋ 开启桌下存储"}
              </button>
            )}
            <CellGrid element={item} items={mats} />
          </div>
        ) : (
          <p className="text-sm text-muted">{def.label}用于划定房间范围，可直接改数值或在画布上拖动/缩放。</p>
        )}

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="X 位置" unit="cm" value={draft.x} min={0} max={ROOM_MAX_CM} onCommit={v => patch({ x: v })} />
            <NumField label="Y 位置" unit="cm" value={draft.y} min={0} max={ROOM_MAX_CM} onCommit={v => patch({ y: v })} />
            <NumField label="宽" unit="cm" value={draft.w} min={MIN_ELEMENT_CM} max={ROOM_MAX_CM} onCommit={v => patch({ w: v })} />
            <NumField label="深" unit="cm" value={draft.h} min={MIN_ELEMENT_CM} max={ROOM_MAX_CM} onCommit={v => patch({ h: v })} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <NumField label="旋转" unit="°" value={draft.rotation} min={-180} max={180} onCommit={v => patch({ rotation: v })} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-medium text-muted">常用尺寸（cm）</span>
              {item
                ? <PresetButtons presets={SIZE_PRESETS[item.type]} current={[draft.w, draft.h]} onPick={(w, h) => patch({ w, h })} />
                : <LengthPresets presets={POS_PRESETS[kindOf(draft)]} current={draft.w} onPick={w => patch({ w })} />}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {isItem && (
            <button onClick={() => onDelete(element.id)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 dark:hover:bg-red-950">
              删除
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-surface-hover">取消</button>
          <button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">保存</button>
        </div>
      </div>
    </div>
  );
}

"use client";

/** 元素属性弹窗：cm 位置/尺寸/旋转 + 按类型的「行 × 列」格位；调用方按 element.id 加 key，切换元素时整体重挂载 */
import { useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import type { ItemElement, ItemType, PosElement } from "./layoutTypes";
import { ELEMENT_DEFS, ITEM_TYPES, cellAxes, cellSummary } from "./layoutTypes";
import { COLS_MAX, MIN_ELEMENT_CM, ROOM_MAX_CM, ROWS_MAX } from "./layoutUnits";
import { POS_PRESETS, SIZE_PRESETS } from "./layoutPresets";
import { LengthPresets, NumField, PresetButtons, inputCls } from "./PropertyFields";

interface PropertyDialogProps {
  element: PosElement | ItemElement;
  roomCode: string;
  onSave: (el: PosElement | ItemElement) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** 打开正视细节视图（仅物品元素） */
  onDetail?: (el: ItemElement) => void;
}

type Draft = PosElement | ItemElement;

function kindOf(el: PosElement): "wall" | "door" | "window" {
  if (el.id.startsWith("door-")) return "door";
  if (el.id.startsWith("window-")) return "window";
  return "wall";
}

export function PropertyDialog({ element, roomCode, onSave, onDelete, onClose, onDetail }: PropertyDialogProps) {
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
      <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
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
          {item && onDetail && (
            <button onClick={() => onDetail(item)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:border-sky-400 hover:text-sky-600">
              <LayoutGrid className="h-4 w-4" />正视详情
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

"use client";

/** 双击元素弹出的属性编辑弹窗：名称/类型/locCode（货架：层数/位数）。调用方按 element.id 加 key，切换元素时整体重挂载 */
import { useState } from "react";
import { X } from "lucide-react";
import type { ItemElement, ItemType, PosElement } from "./layoutTypes";
import { ELEMENT_DEFS, ITEM_TYPES } from "./layoutTypes";

interface PropertyDialogProps {
  element: PosElement | ItemElement;
  roomCode: string;
  onSave: (el: PosElement | ItemElement) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface FormState {
  name: string;
  type: ItemType;
  locCode: string;
  shelfCount: string;
  positionCount: string;
}

export function PropertyDialog({ element, roomCode, onSave, onDelete, onClose }: PropertyDialogProps) {
  const isItem = "type" in element;
  const kind = isItem ? element.type : element.id.startsWith("wall-") ? "wall" : element.id.startsWith("door-") ? "door" : "window";
  const def = ELEMENT_DEFS[kind];

  const [form, setForm] = useState<FormState>(() => ({
    name: isItem ? element.name : def.label,
    type: isItem ? element.type : "shelf",
    locCode: isItem ? element.locCode || "" : "",
    shelfCount: String(isItem && element.type === "shelf" ? element.shelfCount ?? 4 : 4),
    positionCount: String(isItem && element.type === "shelf" ? element.positionCount ?? 8 : 8),
  }));

  const handleSave = () => {
    if (!isItem) { onClose(); return; }
    const isShelf = form.type === "shelf";
    const shelfCount = Math.max(1, Math.min(9, parseInt(form.shelfCount, 10) || 4));
    const positionCount = Math.max(1, Math.min(99, parseInt(form.positionCount, 10) || 8));
    onSave({
      ...element,
      type: form.type,
      name: form.name.trim() || def.label,
      locCode: form.locCode.trim(),
      shelfCount: isShelf ? shelfCount : undefined,
      positionCount: isShelf ? positionCount : undefined,
    });
  };

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: def.color }} />
            {def.label}属性
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        {isItem ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">名称</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={def.label} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">类型</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ItemType })}
                  className={inputCls}>
                  {ITEM_TYPES.map(t => <option key={t} value={t}>{ELEMENT_DEFS[t].label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">库位编码 <span className="text-xs text-faint">（如 {roomCode}-A，物料按此前缀挂载）</span></label>
              <input value={form.locCode} onChange={e => setForm({ ...form, locCode: e.target.value })} placeholder={`${roomCode}-A`} className={inputCls} />
            </div>
            {form.type === "shelf" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">层数</label>
                  <input type="number" min={1} max={9} value={form.shelfCount} onChange={e => setForm({ ...form, shelfCount: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">每层位数</label>
                  <input type="number" min={1} max={99} value={form.positionCount} onChange={e => setForm({ ...form, positionCount: e.target.value })} className={inputCls} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {def.label}的尺寸与位置请在画布上直接拖动调整，按住 Shift 边角可旋转。
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          {isItem && (
            <button onClick={() => onDelete(element.id)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 dark:hover:bg-red-950">
              删除
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-surface-hover">
            取消
          </button>
          <button onClick={handleSave} disabled={!isItem}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

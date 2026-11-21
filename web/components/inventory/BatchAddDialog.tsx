"use client";

/**
 * 批量添加元素：按「行 × 列 + 间距 + 起始坐标」一次生成多个货架/柜子等，
 * 不用再一个一个加、逐个算坐标。只追加新元素，不修改已有布局。
 */
import { useState } from "react";
import { X } from "lucide-react";
import { ELEMENT_DEFS, type ElementKind, type ItemElement, type PosElement, type RoomLayout } from "./layoutTypes";

interface BatchAddDialogProps {
  open: boolean;
  roomCode: string;
  layout: RoomLayout;
  onClose: () => void;
  onAdd: (elements: (PosElement | ItemElement)[]) => void;
}

const KINDS: ElementKind[] = ["shelf", "cabinet", "workbench", "drawer", "device", "pegboard", "wall", "door", "window"];
const inputCls = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm";

export function BatchAddDialog({ open, roomCode, layout, onClose, onAdd }: BatchAddDialogProps) {
  const [kind, setKind] = useState<ElementKind>("shelf");
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(4);
  const [gap, setGap] = useState(20);
  const [startX, setStartX] = useState(40);
  const [startY, setStartY] = useState(40);
  const [customW, setCustomW] = useState(0);
  const [customH, setCustomH] = useState(0);
  const [namePrefix, setNamePrefix] = useState("");

  if (!open) return null;

  const def = ELEMENT_DEFS[kind];
  const ew = customW > 0 ? customW : def.w;
  const eh = customH > 0 ? customH : def.h;
  const total = Math.max(1, rows) * Math.max(1, cols);
  const spanW = Math.max(1, cols) * (ew + gap) - gap;
  const spanH = Math.max(1, rows) * (eh + gap) - gap;
  const overflow = startX + spanW > layout.width || startY + spanH > layout.height;

  const build = () => {
    const used = new Set(layout.items.map((i) => (i.locCode ?? "").toUpperCase()).filter(Boolean));
    const out: (PosElement | ItemElement)[] = [];
    const now = Date.now().toString(36);
    let idx = 0;
    for (let r = 0; r < Math.max(1, rows); r++) {
      for (let c = 0; c < Math.max(1, cols); c++) {
        const id = `${kind}-${now}-${idx}`;
        const base = { id, x: startX + c * (ew + gap), y: startY + r * (eh + gap), w: ew, h: eh, rotation: 0 };
        if (kind === "wall" || kind === "door" || kind === "window") {
          out.push(base);
        } else {
          // 库位编码：房间号 + 字母，跳过已占用的
          let letter = String.fromCharCode(65 + ((layout.items.length + idx) % 26));
          let code = `${roomCode}-${letter}`;
          while (used.has(code.toUpperCase())) {
            letter = String.fromCharCode(letter.charCodeAt(0) + 1);
            code = `${roomCode}-${letter}`;
          }
          used.add(code.toUpperCase());
          out.push({
            ...base, type: kind,
            name: (namePrefix.trim() || def.label) + (idx + 1),
            locCode: code, rows: def.rows ?? 1, cols: def.cols ?? 1,
          });
        }
        idx++;
      }
    }
    return out;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">批量添加</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-hover" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">元素类型</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as ElementKind)} className={inputCls}>
              {KINDS.map((k) => <option key={k} value={k}>{ELEMENT_DEFS[k].label}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">行数</span>
              <input type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">列数</span>
              <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Number(e.target.value) || 1)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">间距（cm）</span>
              <input type="number" min={0} max={200} value={gap} onChange={(e) => setGap(Number(e.target.value) || 0)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">名称前缀（可选）</span>
              <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} placeholder={def.label} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">起始 X（cm）</span>
              <input type="number" min={0} value={startX} onChange={(e) => setStartX(Number(e.target.value) || 0)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">起始 Y（cm）</span>
              <input type="number" min={0} value={startY} onChange={(e) => setStartY(Number(e.target.value) || 0)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">单个宽度（cm，0=默认）</span>
              <input type="number" min={0} value={customW} onChange={(e) => setCustomW(Number(e.target.value) || 0)} placeholder={String(def.w)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">单个高度（cm，0=默认）</span>
              <input type="number" min={0} value={customH} onChange={(e) => setCustomH(Number(e.target.value) || 0)} placeholder={String(def.h)} className={inputCls} />
            </label>
          </div>

          <div className={`rounded-lg px-3 py-2 text-xs ${overflow ? "bg-danger/10 text-danger" : "bg-surface-subtle text-muted"}`}>
            将添加 <b>{total}</b> 个「{def.label}」，占用约 {Math.round(spanW)} × {Math.round(spanH)} cm
            （每个 {Math.round(ew)} × {Math.round(eh)} cm）。{overflow ? "超出房间范围，请调小起始坐标或间距。" : ""}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm">取消</button>
            <button onClick={() => { onAdd(build()); onClose(); }} disabled={overflow}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              添加 {total} 个
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

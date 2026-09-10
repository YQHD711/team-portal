"use client";

/** 属性弹窗的表单控件：cm 数值输入（回车/失焦提交，避免输入中途被打断）与尺寸预设按钮 */
import { useState } from "react";
import { clamp, cm } from "./layoutUnits";

export const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

interface NumFieldProps {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
  title?: string;
}

/** 数值输入：本地文本态，回车/失焦时夹取范围并提交 */
export function NumField({ label, value, unit, min, max, step = 1, onCommit, title }: NumFieldProps) {
  const [text, setText] = useState(() => cm(value));
  const [seen, setSeen] = useState(value);
  // 外部改动（尺寸预设/画布拖动）时同步输入框文本：渲染期调整 state（React 官方推荐写法）
  if (seen !== value) {
    setSeen(value);
    setText(cm(value));
  }
  const commit = () => {
    const n = parseFloat(text);
    const next = Number.isFinite(n) ? clamp(n, min, max) : value;
    setText(cm(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="block" title={title}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}{unit ? `（${unit}）` : ""}</span>
      <input
        type="number" inputMode="decimal" value={text} step={step} min={min} max={max}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        className={inputCls} />
    </label>
  );
}

/** 尺寸预设：一键套用常用规格 */
export function PresetButtons({ presets, onPick, current }: { presets: [number, number][]; onPick: (w: number, h: number) => void; current?: [number, number] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map(([w, h]) => {
        const active = current && current[0] === w && current[1] === h;
        return (
          <button key={`${w}-${h}`} type="button" onClick={() => onPick(w, h)}
            className={`rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
              active ? "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "border-border text-muted hover:border-sky-400"
            }`}>
            {w}×{h}
          </button>
        );
      })}
    </div>
  );
}

/** 长度预设（墙/门/窗） */
export function LengthPresets({ presets, onPick, current }: { presets: number[]; onPick: (len: number) => void; current?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map(len => (
        <button key={len} type="button" onClick={() => onPick(len)}
          className={`rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
            current === len ? "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "border-border text-muted hover:border-sky-400"
          }`}>
          {len} cm
        </button>
      ))}
    </div>
  );
}

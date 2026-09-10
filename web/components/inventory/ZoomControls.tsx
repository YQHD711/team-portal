"use client";

/** 画布缩放控件：缩小/百分比/放大/适应窗口，可插入额外按钮（如平移模式） */
import type { ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

const btn = "rounded p-1 text-muted hover:bg-surface-hover";

export function ZoomControls({ scale, onZoom, onFit, className = "bottom-2 right-2", children }: {
  scale: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  /** 定位类（默认右下角；移动端可改到左上，避开悬浮聊天按钮） */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`absolute z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-sm ${className}`}>
      <button type="button" onClick={() => onZoom(1 / 1.25)} title="缩小" className={btn}><Minus className="h-4 w-4" /></button>
      <span className="w-10 text-center text-[11px] tabular-nums text-faint">{Math.round(scale * 100)}%</span>
      <button type="button" onClick={() => onZoom(1.25)} title="放大" className={btn}><Plus className="h-4 w-4" /></button>
      <button type="button" onClick={onFit} title="适应窗口" className={btn}><Maximize2 className="h-4 w-4" /></button>
      {children}
    </div>
  );
}

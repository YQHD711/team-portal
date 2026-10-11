"use client";

import { useRef, useState } from "react";
import { deltaMm, moveRect, resizeRect, type Corner, type PageSize, type Rect } from "@/lib/labelGeometry";
import type { LabelElement } from "@/lib/labelTemplate";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const CORNER_POS: Record<Corner, { left?: number; right?: number; top?: number; bottom?: number }> = {
  nw: { left: -5, top: -5 }, ne: { right: -5, top: -5 }, sw: { left: -5, bottom: -5 }, se: { right: -5, bottom: -5 },
};

interface Props {
  el: LabelElement;
  page: PageSize;
  pxPerMm: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, rect: Rect) => void;
}

/**
 * 画布上的一个元素框：拖本体=移动、拖四角=缩放。
 * 指针位移在 window 上跟踪（拖出画布也不会断），几何交给 labelGeometry（吸附 0.5mm + 夹在页面内）。
 */
export function ElementBox({ el, page, pxPerMm, selected, onSelect, onChange }: Props) {
  const session = useRef<{ mode: "move" | Corner; startX: number; startY: number; rect: Rect } | null>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = (mode: "move" | Corner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    session.current = { mode, startX: e.clientX ?? 0, startY: e.clientY ?? 0, rect: { x: el.x, y: el.y, w: el.w, h: el.h } };
    setDragging(true);

    const move = (ev: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      const { dxMm, dyMm } = deltaMm((ev.clientX ?? 0) - s.startX, (ev.clientY ?? 0) - s.startY, pxPerMm);
      onChange(el.id, s.mode === "move" ? moveRect(s.rect, page, dxMm, dyMm) : resizeRect(s.rect, page, s.mode, dxMm, dyMm));
    };
    const up = () => {
      session.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div data-testid="designer-element" data-element-id={el.id} data-selected={selected ? "true" : undefined}
      onPointerDown={startDrag("move")}
      className={`absolute touch-none select-none ${selected ? "border-2 border-sky-500 bg-sky-400/10" : "border border-dashed border-sky-400/40"} ${dragging ? "opacity-80" : ""}`}
      style={{ left: el.x * pxPerMm, top: el.y * pxPerMm, width: el.w * pxPerMm, height: el.h * pxPerMm }}>
      <span className="pointer-events-none absolute -top-4 left-0 whitespace-nowrap text-[10px] font-medium text-sky-600">
        {el.type}{el.field ? ` · ${el.field}` : el.text ? " · 文字" : ""}
      </span>
      {selected && CORNERS.map(c => (
        <button key={c} type="button" data-testid={`handle-${c}`} aria-label={`缩放 ${c}`} onPointerDown={startDrag(c)}
          className="absolute h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-white bg-sky-500"
          style={CORNER_POS[c]} />
      ))}
    </div>
  );
}

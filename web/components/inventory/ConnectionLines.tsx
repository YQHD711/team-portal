"use client";

/** 物料 ↔ 货架格子连线视图：SVG overlay 画在面板与画布之间，悬停物料或格子时高亮对应线（仅供查看） */
import { useEffect, useRef, useState } from "react";
import type { ItemElement, MaterialItem } from "./layoutTypes";

export interface LineEnd {
  x: number;
  y: number;
}

export interface ConnectionLine {
  id: number;
  code: string;
  from: LineEnd;
  to: LineEnd;
  color: string;
}

const PALETTE = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#06b6d4", "#84cc16", "#f97316"];

/** 汇总连线数据：物料 locCode → 命中画布元素（货架四段→格子，非货架→元素整体）；两端锚点都存在才连线 */
export function buildConnectionLines(
  items: MaterialItem[],
  elements: ItemElement[],
  itemAnchors: Map<number, LineEnd>,
  cellCenters: Map<string, LineEnd>
): ConnectionLine[] {
  const out: ConnectionLine[] = [];
  for (const it of items) {
    const loc = it.locationCode || "";
    const parts = loc.split("-");
    // 货架：四段编码 → 格子；非货架：完整 locCode（或以 locCode- 开头的兼容格式）→ 元素整体
    let code = "";
    if (parts.length >= 4) {
      const shelf = elements.find(e => e.type === "shelf" && e.locCode && loc.startsWith(e.locCode + "-"));
      if (shelf) code = `${shelf.locCode}-${parts[2]}-${parts[3]}`;
    }
    if (!code) {
      const el = elements.find(e => e.type !== "shelf" && e.locCode && (loc === e.locCode || loc.startsWith(e.locCode + "-")));
      if (el) code = el.locCode!;
    }
    if (!code) continue;
    const from = itemAnchors.get(it.id);
    const to = cellCenters.get(code);
    if (from && to) out.push({ id: it.id, code, from, to, color: PALETTE[it.id % PALETTE.length] });
  }
  return out;
}

interface ConnectionLinesProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  lines: ConnectionLine[];
  /** 高亮键：物料 id 字符串 或 格子编码 */
  hoverKey: string | null;
}

export function ConnectionLines({ containerRef, lines, hoverKey }: ConnectionLinesProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      const r = el.getBoundingClientRect();
      setOrigin({ x: r.left, y: r.top });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
    };
  }, [containerRef]);

  if (size.w === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-10" width={size.w} height={size.h}>
      {lines.map(line => {
        const hot = hoverKey !== null && (hoverKey === String(line.id) || hoverKey === line.code);
        return (
          <line key={line.id}
            x1={line.from.x - origin.x} y1={line.from.y - origin.y}
            x2={line.to.x - origin.x} y2={line.to.y - origin.y}
            stroke={line.color} strokeWidth={hot ? 2.5 : 1.5}
            strokeOpacity={hot ? 0.9 : 0.35} />
        );
      })}
    </svg>
  );
}

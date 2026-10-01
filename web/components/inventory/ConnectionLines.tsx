"use client";

/** 物料 ↔ 元素格位连线视图：SVG overlay 画在面板与画布之间，悬停物料或格位时高亮对应线（仅供查看） */
import { useEffect, useState } from "react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { findElementByLoc, locationKey } from "./locationCodes";

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

/** 汇总连线数据：物料编码 → 命中元素的格位/整体；两端锚点都存在才连线 */
export function buildConnectionLines(
  items: MaterialItem[],
  elements: ItemElement[],
  itemAnchors: Map<number, LineEnd>,
  cellCenters: Map<string, LineEnd>
): ConnectionLine[] {
  const out: ConnectionLine[] = [];
  for (const it of items) {
    const el = findElementByLoc(elements, it.locationCode || "");
    if (!el) continue;
    const code = locationKey(el, it.locationCode || "");
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
  /** 高亮键：物料 id 字符串 或 格位编码 */
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
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [containerRef]);

  if (size.w === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-10" width={size.w} height={size.h}>
      {lines.map(line => {
        const hot = hoverKey !== null && (hoverKey === String(line.id) || hoverKey === line.code);
        const x1 = line.from.x - origin.x;
        const y1 = line.from.y - origin.y;
        const x2 = line.to.x - origin.x;
        const y2 = line.to.y - origin.y;
        const ends = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
        return (
          <g key={line.id}>
            {/* 同色低透明度加粗底衬：让细线在浅色画布上也有存在感 */}
            <line data-testid="connection-halo"
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={line.color} strokeWidth={hot ? 10 : 8}
              strokeOpacity={hot ? 0.28 : 0.14} strokeLinecap="round" />
            {/* 主线：3px 圆头，hover 增粗提亮 */}
            <line data-testid="connection-line"
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={line.color} strokeWidth={hot ? 4.5 : 3}
              strokeOpacity={hot ? 1 : 0.8} strokeLinecap="round" />
            {/* 两端圆点：明确「物料 ↔ 格位」的落点 */}
            {ends.map((p, i) => (
              <circle key={i} data-testid="connection-dot" cx={p.x} cy={p.y}
                r={hot ? 4 : 3} fill={line.color} fillOpacity={hot ? 1 : 0.85} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

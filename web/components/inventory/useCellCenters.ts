/** 上报画布上「有物料挂载的元素」中心点视口坐标（格位元素按格位、整体挂载按元素中心，连线视图用） */
import { useEffect, useRef } from "react";
import type Konva from "konva";
import type { MaterialItem, RoomLayout } from "./layoutTypes";
import { usesCells } from "./layoutTypes";
import { WHOLE_CELL_KEY, cellKey, itemHitCells } from "./elementGeometry";
import { cellCounts } from "./locationCodes";

export interface CellCenter {
  x: number;
  y: number;
}

export function useCellCenters(
  layout: RoomLayout,
  items: MaterialItem[],
  view: { scale: number; x: number; y: number },
  stageRef: React.RefObject<Konva.Stage | null>,
  onCenters: (centers: Map<string, CellCenter>) => void
) {
  const onCentersRef = useRef(onCenters);
  useEffect(() => { onCentersRef.current = onCenters; }, [onCenters]);

  const { scale, x, y } = view;
  useEffect(() => {
    const report = () => {
      const stage = stageRef.current;
      const canvas = stage?.getContent();
      if (!canvas || scale <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const m = new Map<string, CellCenter>();
      for (const el of layout.items) {
        if (!el.locCode) continue;
        const counts = cellCounts(el, items);
        for (const cell of itemHitCells(el)) {
          const key = usesCells(el) ? cellKey(cell.row, cell.col) : WHOLE_CELL_KEY;
          if (!counts.has(key)) continue;
          m.set(cell.code, {
            x: rect.left + cell.cx * scale + x,
            y: rect.top + cell.cy * scale + y,
          });
        }
      }
      onCentersRef.current(m);
    };
    report();
    const canvas = stageRef.current?.getContent();
    const ro = canvas ? new ResizeObserver(report) : null;
    ro?.observe(canvas!);
    window.addEventListener("resize", report);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [layout, items, scale, x, y, stageRef]);
}

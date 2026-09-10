"use client";

/** 画布格位渲染：按元素类型着色的 行×列 格位（含数量、低库存预警） */
import { Fragment } from "react";
import { Rect, Text } from "react-konva";
import type { ItemElement } from "./layoutTypes";
import type { ElementCell } from "./elementGeometry";
import { cellFill } from "./cellColors";
import { useLowStock } from "./LowStockProvider";

interface ElementCellsProps {
  el: ItemElement;
  cells: ElementCell[];
  counts: Map<string, number>;
  /** 画布缩放：格位数量文字按屏幕尺寸决定是否绘制 */
  scale?: number;
  onCellHover?: (code: string | null) => void;
  onCellClick?: (code: string, cell: ElementCell) => void;
}

export function ElementCells({ el, cells, counts, scale = 1, onCellHover, onCellClick }: ElementCellsProps) {
  const { threshold } = useLowStock();
  return (
    <>
      {cells.map(cell => {
        const qty = counts.get(`${cell.row}-${cell.col}`) || 0;
        // 屏幕上一个格位放不下数字时只留颜色（蓝=有货 / 琥珀=不足 / 白=空位）
        const fits = cell.w * scale >= 14 && cell.h * scale >= 8;
        return (
          <Fragment key={`${cell.row}-${cell.col}`}>
            <Rect
              x={cell.lx} y={cell.ly}
              width={Math.max(1, cell.w - 1.2)} height={Math.max(1, cell.h - 1.2)}
              fill={cellFill(el.type, qty, threshold)}
              cornerRadius={1.5}
              onMouseEnter={onCellHover && cell.code ? () => onCellHover(cell.code) : undefined}
              onMouseLeave={onCellHover ? () => onCellHover(null) : undefined}
              onClick={onCellClick ? (e) => { e.cancelBubble = true; onCellClick(cell.code, cell); } : undefined}
            />
            {qty > 0 && fits && cell.w > 10 && cell.h > 6 && (
              <Text text={String(qty)}
                x={cell.lx} y={cell.ly + 0.5}
                width={cell.w} height={cell.h - 1} align="center" verticalAlign="middle"
                fontSize={Math.max(7, Math.min(9, cell.w * 0.45, cell.h * 0.9))}
                fill="#ffffff" fontStyle="bold" listening={false} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

"use client";

/** 拖拽悬停提示：元素外框绿色描边 + 货架命中格子绿色高亮（编辑器画布用） */
import { Rect } from "react-konva";
import type { ItemElement } from "./layoutTypes";
import { shelfCells } from "./shelfGeometry";

const DROP_COLOR = "#22c55e";

/** row/col 缺省（非货架元素）时仅描边整体 */
export function DropHighlight({ el, row, col }: { el: ItemElement; row?: number; col?: number }) {
  const cell = row !== undefined && col !== undefined
    ? shelfCells(el)[row * (el.positionCount ?? 8) + col]
    : null;
  return (
    <>
      <Rect
        x={el.x + el.w / 2} y={el.y + el.h / 2}
        offsetX={el.w / 2 + 3} offsetY={el.h / 2 + 3}
        width={el.w + 6} height={el.h + 6} rotation={el.rotation}
        stroke={DROP_COLOR} strokeWidth={2} cornerRadius={5} listening={false}
      />
      {cell && (
        <Rect
          x={cell.cx} y={cell.cy}
          offsetX={cell.w / 2} offsetY={cell.h / 2}
          width={cell.w - 1.5} height={cell.h - 1.5} rotation={el.rotation}
          fill="rgba(34,197,94,0.45)" cornerRadius={1.5} listening={false}
        />
      )}
    </>
  );
}

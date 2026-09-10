"use client";

/** 拖拽/点选悬停提示：元素外框绿色描边 + 命中格位绿色高亮 */
import { Rect } from "react-konva";
import type { ItemElement } from "./layoutTypes";
import { colsOf } from "./layoutTypes";
import { elementCells } from "./elementGeometry";

const DROP_COLOR = "#22c55e";

/** row/col 缺省（整体挂载元素）时仅描边整体 */
export function DropHighlight({ el, row, col }: { el: ItemElement; row?: number; col?: number }) {
  const cell = row !== undefined && col !== undefined
    ? elementCells(el)[row * colsOf(el) + col]
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
          width={cell.w - 1.2} height={cell.h - 1.2} rotation={el.rotation}
          fill="rgba(34,197,94,0.45)" cornerRadius={1.5} listening={false}
        />
      )}
    </>
  );
}

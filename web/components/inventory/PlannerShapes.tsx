"use client";

/** 平面图 Konva 形状：网格背景 / 墙门窗 / 物品元素（含货架格子物料热点） */
import { Fragment } from "react";
import { Group, Rect, Shape, Text } from "react-konva";
import type Konva from "konva";
import type { ItemElement, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { ELEMENT_DEFS } from "./layoutTypes";
import { cellCounts, shelfCells, WHOLE_CELL_KEY } from "./shelfGeometry";

const GRID_STEP = 20;
const SELECT_COLOR = "#f43f5e";
const CELL_EMPTY = "rgba(255,255,255,0.28)";
const CELL_LOW = "#f59e0b";
const CELL_OK = "#1d4ed8";

/** 网格背景 + 画布边框（非交互，编辑器与查看器共用） */
export function GridShape({ layout }: { layout: RoomLayout }) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.setAttr("strokeStyle", "#e4e4e7");
        ctx.setAttr("lineWidth", 1);
        for (let x = GRID_STEP; x < layout.width; x += GRID_STEP) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.height); ctx.stroke();
        }
        for (let y = GRID_STEP; y < layout.height; y += GRID_STEP) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(layout.width, y); ctx.stroke();
        }
        ctx.setAttr("strokeStyle", "#a1a1aa");
        ctx.setAttr("lineWidth", 2);
        ctx.strokeRect(0, 0, layout.width, layout.height);
      }}
    />
  );
}

interface ShapeProps {
  el: PosElement;
  selected?: boolean;
  draggable?: boolean;
  ref?: React.Ref<Konva.Group>;
  onClick?: () => void;
  onDblClick?: () => void;
  onDragEnd?: (el: PosElement) => void;
  onTransformEnd?: (el: PosElement) => void;
  highlight?: boolean;
}

/** 墙/门/窗：薄矩形，按类型着色 */
export function PosShape({ el, kind, selected, draggable, ref, onClick, onDblClick, onDragEnd, onTransformEnd, highlight }: ShapeProps & { kind: "wall" | "door" | "window" }) {
  return (
    <Group
      ref={ref}
      x={el.x} y={el.y} rotation={el.rotation}
      width={el.w} height={el.h}
      draggable={draggable}
      onClick={onClick}
      onDblClick={onDblClick}
      onDragEnd={onDragEnd ? (e) => onDragEnd({ ...el, x: e.target.x(), y: e.target.y() }) : undefined}
      onTransformEnd={onTransformEnd ? handleTransformEnd(el, onTransformEnd) : undefined}
    >
      <Rect
        width={el.w} height={el.h} fill={ELEMENT_DEFS[kind].color} cornerRadius={2}
        opacity={kind === "window" ? 0.7 : 1}
        stroke={selected || highlight ? SELECT_COLOR : undefined}
        strokeWidth={selected || highlight ? 2 : 0}
        dash={kind === "window" ? [4, 4] : undefined}
      />
      <Text
        text={ELEMENT_DEFS[kind].label}
        x={2} y={-16} fontSize={11} fill={ELEMENT_DEFS[kind].color} listening={false}
      />
    </Group>
  );
}

/** 物品元素：色块 + 名称标签；货架内部按 层×位 画格子并显示物料热点 */
export function ItemShape({ el, items, selected, draggable, ref, onClick, onDblClick, onDragEnd, onTransformEnd, highlight, onCellHover }: ShapeProps & { el: ItemElement; items: MaterialItem[]; onCellHover?: (code: string | null) => void }) {
  const def = ELEMENT_DEFS[el.type];
  const counts = cellCounts(el, items);
  const totalQty = el.type === "shelf" ? 0 : counts.get(WHOLE_CELL_KEY) || 0;
  const labelH = el.type === "shelf" && el.h > 30 ? 16 : 14;
  return (
    <Group
      ref={ref}
      x={el.x} y={el.y} rotation={el.rotation}
      width={el.w} height={el.h}
      draggable={draggable}
      onClick={onClick}
      onDblClick={onDblClick}
      onDragEnd={onDragEnd ? (e) => onDragEnd({ ...el, x: e.target.x(), y: e.target.y() }) : undefined}
      onTransformEnd={onTransformEnd ? handleTransformEnd(el, onTransformEnd) : undefined}
    >
      <Rect width={el.w} height={el.h} fill={def.color} cornerRadius={4}
        stroke={selected || highlight ? SELECT_COLOR : undefined}
        strokeWidth={selected || highlight ? 2 : 0} />
      <Text text={el.name} x={4} y={3} width={el.w - 8} height={labelH} fontSize={11}
        fontStyle="bold" fill="#ffffff" listening={false} ellipsis />
      {el.locCode && (
        <Text text={el.locCode} x={4} y={labelH + 2} width={el.w - 8} fontSize={9}
          fill="rgba(255,255,255,0.85)" listening={false} ellipsis />
      )}
      {el.type !== "shelf" && totalQty > 0 && (
        <>
          <Rect x={el.w - 28} y={2} width={26} height={14} cornerRadius={7} fill="#dc2626" listening={false} />
          <Text text={`×${totalQty}`} x={el.w - 28} y={3} width={26} align="center" fontSize={9}
            fontStyle="bold" fill="#ffffff" listening={false} />
        </>
      )}
      {el.type === "shelf" && el.shelfCount && el.positionCount ? (
        <ShelfCells el={el} counts={counts} onCellHover={onCellHover} />
      ) : null}
    </Group>
  );
}

/** 货架格子：几何来自 shelfGeometry（与命中/连线一致），hover 上报格子编码 */
function ShelfCells({ el, counts, onCellHover }: { el: ItemElement; counts: Map<string, number>; onCellHover?: (code: string | null) => void }) {
  const cells = shelfCells(el);
  return (
    <>
      {cells.map(cell => {
        const qty = counts.get(`${cell.row}-${cell.col}`) || 0;
        return (
          <Fragment key={`${cell.row}-${cell.col}`}>
            <Rect
              x={cell.lx} y={cell.ly}
              width={Math.max(1, cell.w - 1.5)} height={Math.max(1, cell.h - 1.5)}
              fill={qty > 0 ? (qty < 3 ? CELL_LOW : CELL_OK) : CELL_EMPTY}
              cornerRadius={1.5}
              onMouseEnter={onCellHover && cell.code ? () => onCellHover(cell.code) : undefined}
              onMouseLeave={onCellHover ? () => onCellHover(null) : undefined}
            />
            {qty > 0 && cell.w > 10 && cell.h > 8 && (
              <Text text={String(qty)}
                x={cell.lx} y={cell.ly + 1}
                width={cell.w} height={cell.h - 2} align="center" verticalAlign="middle"
                fontSize={Math.min(9, cell.w * 0.5)} fill="#ffffff" fontStyle="bold" listening={false} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** Transformer 缩放结束后：把 scale 归一化回宽高与旋转 */
function handleTransformEnd(el: PosElement, onTransformEnd: (el: PosElement) => void) {
  return (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Group;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onTransformEnd({
      ...el,
      x: node.x(),
      y: node.y(),
      w: Math.max(8, node.width() * sx),
      h: Math.max(8, node.height() * sy),
      rotation: node.rotation(),
    });
  };
}

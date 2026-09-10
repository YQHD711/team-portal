"use client";

/** 平面图 Konva 形状：cm 标尺网格 / 墙门窗 / 物品元素（按类型渲染格位与尺寸标注） */
import { Group, Rect, Shape, Text } from "react-konva";
import type Konva from "konva";
import type { ItemElement, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { ELEMENT_DEFS, cellSummary, usesCells } from "./layoutTypes";
import { elementCells, headerHeight, type ElementCell } from "./elementGeometry";
import { cellCounts } from "./locationCodes";
import { GRID_STEP_CM, MAJOR_STEP_CM, cm } from "./layoutUnits";
import { ElementCells } from "./PlannerCells";

const SELECT_COLOR = "#f43f5e";
const MINOR_COLOR = "#eef0f3";
const MAJOR_COLOR = "#d4d4d8";
const RULER_COLOR = "#a1a1aa";

/** cm 网格背景 + 100cm 主刻度与尺寸标注；fontScale 用于抵消画布缩放，保证刻度字号恒定 */
export function GridShape({ layout, scale = 1 }: { layout: RoomLayout; scale?: number }) {
  const fs = 10 / Math.max(0.2, scale);
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.setAttr("lineWidth", 1);
        ctx.setAttr("strokeStyle", MINOR_COLOR);
        for (let x = GRID_STEP_CM; x < layout.width; x += GRID_STEP_CM) {
          if (x % MAJOR_STEP_CM === 0) continue;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.height); ctx.stroke();
        }
        for (let y = GRID_STEP_CM; y < layout.height; y += GRID_STEP_CM) {
          if (y % MAJOR_STEP_CM === 0) continue;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(layout.width, y); ctx.stroke();
        }
        ctx.setAttr("strokeStyle", MAJOR_COLOR);
        for (let x = MAJOR_STEP_CM; x < layout.width; x += MAJOR_STEP_CM) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.height); ctx.stroke();
        }
        for (let y = MAJOR_STEP_CM; y < layout.height; y += MAJOR_STEP_CM) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(layout.width, y); ctx.stroke();
        }
        ctx.setAttr("strokeStyle", RULER_COLOR);
        ctx.setAttr("lineWidth", 2);
        ctx.strokeRect(0, 0, layout.width, layout.height);
        // cm 刻度标注（沿上边界与左边界），房间尺寸标在框外左上，避免与 100cm 刻度重叠
        ctx.setAttr("fillStyle", RULER_COLOR);
        ctx.font = `${fs}px sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText(`${layout.width} × ${layout.height} cm`, 0, -3);
        ctx.textBaseline = "top";
        for (let x = MAJOR_STEP_CM; x < layout.width; x += MAJOR_STEP_CM) {
          ctx.fillText(String(x), x + 2, 2);
        }
        for (let y = MAJOR_STEP_CM; y < layout.height; y += MAJOR_STEP_CM) {
          ctx.fillText(String(y), 2, y + 2);
        }
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

/** 墙/门/窗：薄矩形，按类型着色；选中时标注长度（cm） */
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
        text={selected ? `${ELEMENT_DEFS[kind].label} ${cm(el.w)} cm` : ELEMENT_DEFS[kind].label}
        x={2} y={-16} fontSize={11} fill={ELEMENT_DEFS[kind].color} listening={false}
      />
    </Group>
  );
}

interface ItemShapeProps extends ShapeProps {
  el: ItemElement;
  items: MaterialItem[];
  /** 当前画布缩放：用于按屏幕尺寸决定是否绘制文字（低倍率下不显示小字，避免糊成一片） */
  scale?: number;
  onCellHover?: (code: string | null) => void;
  onCellClick?: (code: string, cell: ElementCell) => void;
}

/** 物品元素：类型色块 + 名称/编码/格位规格；有格位时渲染 行×列 网格与物料数量 */
export function ItemShape({ el, items, selected, draggable, ref, onClick, onDblClick, onDragEnd, onTransformEnd, highlight, scale = 1, onCellHover, onCellClick }: ItemShapeProps) {
  const def = ELEMENT_DEFS[el.type];
  const counts = cellCounts(el, items);
  const totalQty = [...counts.values()].reduce((s, n) => s + n, 0);
  const cells = usesCells(el) ? elementCells(el) : [];
  const top = headerHeight(el);
  const headerH = Math.min(el.h - 2, Math.max(10, top));
  const meta = [el.locCode, cellSummary(el)].filter(Boolean).join(" · ");
  // 屏幕上放不下就省掉小字：名称始终画，规格行与尺寸行按屏幕像素决定
  const showMeta = el.h * scale >= 26 && el.w * scale >= 96 && el.h > 30;
  const showDims = selected && el.h > 46 && el.h * scale >= 40;
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
      <Rect x={0} y={0} width={el.w} height={headerH} fill="rgba(0,0,0,0.18)" cornerRadius={[4, 4, 0, 0]} listening={false} />
      <Text text={el.name} x={4} y={2} width={el.w - (totalQty > 0 ? 34 : 8)} height={Math.min(14, headerH - 2)}
        fontSize={11} fontStyle="bold" fill="#ffffff" listening={false} ellipsis />
      {showMeta && (
        <Text text={meta} x={4} y={13} width={el.w - 8} height={Math.max(8, headerH - 14)}
          fontSize={9} fill="rgba(255,255,255,0.88)" listening={false} ellipsis />
      )}
      {totalQty > 0 && (
        <>
          <Rect x={el.w - 30} y={2} width={28} height={14} cornerRadius={7} fill="#dc2626" listening={false} />
          <Text text={`×${totalQty}`} x={el.w - 30} y={3} width={28} align="center" fontSize={9}
            fontStyle="bold" fill="#ffffff" listening={false} />
        </>
      )}
      {cells.length > 0 && (
        <ElementCells el={el} cells={cells} counts={counts} scale={scale} onCellHover={onCellHover} onCellClick={onCellClick} />
      )}
      {showDims && (
        <Text text={`${cm(el.w)} × ${cm(el.h)} cm`} x={4} y={el.h - 11} width={el.w - 8} fontSize={9}
          fill="rgba(255,255,255,0.9)" listening={false} ellipsis />
      )}
    </Group>
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

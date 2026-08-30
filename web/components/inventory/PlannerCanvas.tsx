"use client";

/** 平面图画布：网格背景、元素渲染、Transformer、缩放/平移/选择交互；支持物料拖拽挂载与格子坐标上报 */
import { useEffect, useRef, useState } from "react";
import { Layer, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { Box } from "konva/lib/shapes/Transformer";
import type { ItemElement, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { GridShape, ItemShape, PosShape } from "./PlannerShapes";
import { DropHighlight } from "./DropHighlight";
import { hitItemElement, type ShelfCell } from "./shelfGeometry";
import { useCellCenters, type CellCenter } from "./useCellCenters";

interface PlannerCanvasProps {
  layout: RoomLayout;
  items: MaterialItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDblEdit: (id: string) => void;
  onDragEnd: (el: PosElement | ItemElement) => void;
  onTransformEnd: (el: PosElement | ItemElement) => void;
  onMountMaterial?: (id: number, code: string) => void;
  /** 货架无 locCode 时分配房间内编码（如 1030-B） */
  onAutoLoc?: (el: ItemElement) => string;
  onCellCenters?: (centers: Map<string, CellCenter>) => void;
  onCellHover?: (code: string | null) => void;
}

interface HoverCell {
  el: ItemElement;
  /** 货架：命中的格子；工作台/柜子/设备：null（元素整体高亮） */
  cell: ShelfCell | null;
}

export function PlannerCanvas({ layout, items, selected, onSelect, onDblEdit, onDragEnd, onTransformEnd, onMountMaterial, onAutoLoc, onCellCenters, onCellHover }: PlannerCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Group>>({});
  const centered = useRef(false);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState({ scale: 0.8, x: 0, y: 0 });
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);

  useCellCenters(layout, items, view, stageRef, onCellCenters ?? (() => {}));

  // 容器尺寸测量
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 首次测量完成后把画布居中显示
  useEffect(() => {
    if (centered.current || size.w <= 10) return;
    centered.current = true;
    const scale = Math.min(1, (size.w - 48) / layout.width, (size.h - 48) / layout.height);
    setView({ scale, x: (size.w - layout.width * scale) / 2, y: (size.h - layout.height * scale) / 2 });
  }, [size, layout.width, layout.height]);

  // Transformer 挂载到选中元素
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected ? shapeRefs.current[selected] : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, layout]);

  // 滚轮缩放（以指针为中心）、拖空白平移、点空白取消选中
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const oldScale = view.scale;
    const newScale = Math.min(2.5, Math.max(0.25, oldScale * (e.evt.deltaY > 0 ? 0.9 : 1.1)));
    setView(v => ({
      scale: newScale,
      x: pointer.x - ((pointer.x - v.x) * newScale) / oldScale,
      y: pointer.y - ((pointer.y - v.y) * newScale) / oldScale,
    }));
  };
  const onStageDragEnd = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const { x, y } = stage.position();
    stage.position({ x: 0, y: 0 });
    setView(v => ({ ...v, x: v.x + x, y: v.y + y }));
  };
  const boundBox = (oldBox: Box, newBox: Box) =>
    newBox.width < 8 || newBox.height < 8 ? oldBox : newBox;

  // ── 物料拖拽挂载：屏幕坐标 → 世界坐标（canvas rect 逆变换）→ 命中物品元素 ──
  const pointerToWorld = (evt: DragEvent) => {
    const canvas = stageRef.current?.getContent();
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: (evt.clientX - r.left - view.x) / view.scale, y: (evt.clientY - r.top - view.y) / view.scale };
  };
  const hitCell = (p: { x: number; y: number }): HoverCell | null => {
    for (const el of layout.items) {
      const hit = hitItemElement(el, p.x, p.y);
      if (hit) return hit;
    }
    return null;
  };
  // HTML5 拖放事件绑在外层 div（原生 DOM）——Konva Stage 事件代理对 DragEvent 支持不可靠，
  // 会导致 dragover 不 preventDefault、光标显示禁止符号、drop 无法触发
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 必须显式设置 dropEffect，否则部分浏览器仍显示禁止光标
    e.dataTransfer.dropEffect = "move";
    const p = pointerToWorld(e.nativeEvent);
    const hit = p ? hitCell(p) : null;
    setHoverCell(prev => {
      if (hit === null && prev === null) return prev;
      // cell 为 null（非货架整体）时可选链天然判等，无需区分两种形态
      if (hit && prev && hit.el.id === prev.el.id && hit.cell?.row === prev.cell?.row && hit.cell?.col === prev.cell?.col) return prev;
      return hit;
    });
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHoverCell(null);
    if (!onMountMaterial) return;
    const id = Number(e.dataTransfer?.getData("text/plain"));
    if (!Number.isFinite(id)) return;
    const p = pointerToWorld(e.nativeEvent);
    const hit = p ? hitCell(p) : null;
    if (!hit) return;
    // 货架用格子编码（层-位）；非货架用 locCode 整体挂载；元素没有编码时先自动分配
    let code = hit.cell ? hit.cell.code : hit.el.locCode ?? "";
    if (!code && onAutoLoc) {
      const loc = onAutoLoc(hit.el);
      code = hit.cell ? `${loc}-${hit.cell.row + 1}-${String(hit.cell.col + 1).padStart(2, "0")}` : loc;
    }
    if (code) onMountMaterial(id, code);
  };

  const shapeProps = (id: string) => ({
    selected: selected === id,
    draggable: true,
    ref: (node: Konva.Group | null) => {
      if (node) shapeRefs.current[id] = node;
      else delete shapeRefs.current[id];
    },
    onClick: () => onSelect(id),
    onDblClick: () => onDblEdit(id),
    onDragEnd,
    onTransformEnd,
  });

  return (
    <div ref={wrapRef} className="flex-1 relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white"
      onDragOver={handleDragOver} onDrop={handleDrop} onDragLeave={() => setHoverCell(null)}>
      <Stage
        ref={stageRef} width={size.w} height={size.h}
        draggable onWheel={onWheel} onDragEnd={onStageDragEnd}
        onClick={e => { if (e.target === e.target.getStage()) onSelect(null); }}
      >
        <Layer x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
          <GridShape layout={layout} />
          {layout.walls.map(el => (
            <PosShape key={el.id} el={el} kind="wall" {...shapeProps(el.id)} />
          ))}
          {layout.doors.map(el => (
            <PosShape key={el.id} el={el} kind="door" {...shapeProps(el.id)} />
          ))}
          {layout.windows.map(el => (
            <PosShape key={el.id} el={el} kind="window" {...shapeProps(el.id)} />
          ))}
          {layout.items.map(el => (
            <ItemShape key={el.id} el={el} items={items} onCellHover={onCellHover} {...shapeProps(el.id)} />
          ))}
          {hoverCell && <DropHighlight el={hoverCell.el} row={hoverCell.cell?.row} col={hoverCell.cell?.col} />}
          <Transformer ref={trRef} rotateEnabled boundBoxFunc={boundBox} />
        </Layer>
      </Stage>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-zinc-900/70 px-2 py-1 text-[11px] text-white">
        滚轮缩放 · 拖拽空白平移 · 选中后拖动/边角缩放/旋转 · 双击编辑 · 拖拽物料到元素挂载
      </div>
    </div>
  );
}

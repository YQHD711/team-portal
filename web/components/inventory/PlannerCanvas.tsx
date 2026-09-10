"use client";

/** 平面图画布：cm 网格、元素渲染、Transformer、缩放/平移/选择；支持物料拖拽挂载、点选挂载与格位命中 */
import { useEffect, useRef, useState } from "react";
import { Layer, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { Box } from "konva/lib/shapes/Transformer";
import { Hand } from "lucide-react";
import type { ItemElement, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { GridShape, ItemShape, PosShape } from "./PlannerShapes";
import { DropHighlight } from "./DropHighlight";
import { ZoomControls } from "./ZoomControls";
import { hitItemElement, pad2, type ElementCell } from "./elementGeometry";
import { useCellCenters, type CellCenter } from "./useCellCenters";
import { useStageView } from "./useStageView";

interface PlannerCanvasProps {
  layout: RoomLayout;
  items: MaterialItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDblEdit: (id: string) => void;
  onDragEnd: (el: PosElement | ItemElement) => void;
  onTransformEnd: (el: PosElement | ItemElement) => void;
  onMountMaterial?: (id: number, code: string) => void;
  /** 元素无 locCode 时分配房间内编码（如 1030-B） */
  onAutoLoc?: (el: ItemElement) => string;
  onCellCenters?: (centers: Map<string, CellCenter>) => void;
  onCellHover?: (code: string | null) => void;
  /** 待挂载物料：点画布格位即完成挂载（触屏友好） */
  pendingMount?: { id: number; name: string } | null;
  onCellSelect?: (el: ItemElement, cell: ElementCell | null) => void;
  /** 追加到画布容器的类名（父级控制高度） */
  className?: string;
}

interface HoverCell {
  el: ItemElement;
  /** 格位元素：命中的格子；整体挂载元素：null */
  cell: ElementCell | null;
}

/** 稳定的空回调：避免每次渲染换引用导致上报 effect 反复重建 */
const NOOP = () => {};

export function PlannerCanvas({ layout, items, selected, onSelect, onDblEdit, onDragEnd, onTransformEnd, onMountMaterial, onAutoLoc, onCellCenters, onCellHover, pendingMount, onCellSelect, className = "" }: PlannerCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Group>>({});
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);
  const [panMode, setPanMode] = useState(false);
  const { view, fit, zoomBy, onWheel, onTouchStart, onTouchMove, onTouchEnd, consumeStageDrag } =
    useStageView({ stageRef, width: size.w, height: size.h, contentW: layout.width, contentH: layout.height });

  useCellCenters(layout, items, view, stageRef, onCellCenters ?? NOOP);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Transformer 挂载到选中元素
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected ? shapeRefs.current[selected] : undefined;
    tr.nodes(node && !panMode ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, layout, panMode]);

  const boundBox = (oldBox: Box, newBox: Box) =>
    newBox.width < 8 || newBox.height < 8 ? oldBox : newBox;

  // ── 世界坐标：屏幕像素 → 画布 cm ──
  const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });
  const hitCell = (p: { x: number; y: number }): HoverCell | null => {
    for (const el of layout.items) {
      const hit = hitItemElement(el, p.x, p.y);
      if (hit) return hit;
    }
    return null;
  };
  const resolveCode = (el: ItemElement, cell: ElementCell | null): string => {
    if (cell?.code) return cell.code;
    const loc = el.locCode || onAutoLoc?.(el) || "";
    if (!loc) return "";
    return cell ? `${loc}-${cell.row + 1}-${pad2(cell.col + 1)}` : loc;
  };

  // HTML5 拖放事件绑在外层 div（原生 DOM）：Konva Stage 的事件代理对 DragEvent 支持不可靠
  const dragWorld = (e: React.DragEvent<HTMLDivElement>) => {
    const canvas = stageRef.current?.getContent();
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const p = dragWorld(e);
    const hit = p ? hitCell(p) : null;
    setHoverCell(prev => {
      if (hit === null && prev === null) return prev;
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
    const p = dragWorld(e);
    const hit = p ? hitCell(p) : null;
    if (!hit) return;
    const code = resolveCode(hit.el, hit.cell);
    if (code) onMountMaterial(id, code);
  };

  /** 点选挂载（触屏/鼠标通用）：有 pendingMount 就挂载，否则选中元素并上报格位 */
  const handleCellClick = (el: ItemElement, cell: ElementCell | null) => {
    if (pendingMount && onMountMaterial) {
      const code = resolveCode(el, cell);
      if (code) onMountMaterial(pendingMount.id, code);
      return;
    }
    onSelect(el.id);
    onCellSelect?.(el, cell);
  };

  const shapeProps = (id: string) => ({
    selected: selected === id,
    draggable: !panMode,
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
    <div ref={wrapRef} className={`relative flex-1 overflow-hidden rounded-xl border border-border bg-white ${className}`}
      style={{ touchAction: "none" }}
      onDragOver={handleDragOver} onDrop={handleDrop} onDragLeave={() => setHoverCell(null)}>
      <Stage
        ref={stageRef} width={size.w} height={size.h}
        draggable onWheel={onWheel} onDragEnd={consumeStageDrag}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={e => { if (e.target === e.target.getStage()) onSelect(null); }}
      >
        <Layer x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
          <GridShape layout={layout} scale={view.scale} />
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
            <ItemShape key={el.id} el={el} items={items} scale={view.scale} onCellHover={onCellHover}
              onCellClick={(_code, cell) => handleCellClick(el, cell)} {...shapeProps(el.id)} />
          ))}
          {hoverCell && <DropHighlight el={hoverCell.el} row={hoverCell.cell?.row} col={hoverCell.cell?.col} />}
          <Transformer ref={trRef} rotateEnabled boundBoxFunc={boundBox} />
        </Layer>
      </Stage>

      <ZoomControls scale={view.scale} onZoom={zoomBy} onFit={fit}
        className="bottom-2 right-2 max-lg:bottom-auto max-lg:right-auto max-lg:left-2 max-lg:top-2">
        <button onClick={() => setPanMode(v => !v)} title="平移模式（锁定元素拖动，适合触屏）"
          className={`rounded p-1 ${panMode ? "bg-sky-100 text-sky-600 dark:bg-sky-950" : "text-muted hover:bg-surface-hover"}`}>
          <Hand className="h-4 w-4" />
        </button>
      </ZoomControls>
      <div className="pointer-events-none absolute bottom-2 left-2 hidden rounded-lg bg-zinc-900/70 px-2 py-1 text-[11px] text-white sm:block">
        滚轮/双指缩放 · 拖空白平移 · 选中后拖动/缩放/旋转 · 双击改属性 · 拖拽或点选物料挂载
      </div>
    </div>
  );
}

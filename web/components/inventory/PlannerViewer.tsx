"use client";

/**
 * 平面图查看模式：只读渲染 LayoutJson（cm 网格 / 墙门窗 / 元素格位热点），
 * 支持缩放平移、格位点选查看物料、双击打开正视细节视图、物料连线，移动端面板折叠为抽屉。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import { LayoutGrid, Network, X } from "lucide-react";
import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";
import { cellSummary } from "./layoutTypes";
import { GridShape, ItemShape, PosShape } from "./PlannerShapes";
import { MaterialsPanel } from "./MaterialsPanel";
import { ConnectionLines } from "./ConnectionLines";
import { ElementDetail } from "./ElementDetail";
import { MobileDrawer } from "./MobileDrawer";
import { ZoomControls } from "./ZoomControls";
import { useMountingView } from "./useMountingState";
import { useCellCenters } from "./useCellCenters";
import { useStageView } from "./useStageView";
import { cellKey, cellLabelAt, type ElementCell } from "./elementGeometry";
import { elementMaterials, materialsByCell } from "./locationCodes";

interface PlannerViewerProps {
  layout: RoomLayout;
  roomCode: string;
  items: MaterialItem[];
}

interface Selection {
  el: ItemElement;
  cell: ElementCell | null;
}

export function PlannerViewer({ layout, roomCode, items }: PlannerViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<{ el: ItemElement; cell: string | null } | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { setItemAnchors, setCellCenters, hoverKey, setHoverKey, lines } = useMountingView(items, layout.items);
  const { view, fit, zoomBy, onWheel, onTouchStart, onTouchMove, onTouchEnd, consumeStageDrag } =
    useStageView({ stageRef, width: size.w, height: size.h, contentW: layout.width, contentH: layout.height });
  useCellCenters(layout, items, view, stageRef, setCellCenters);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cellItems = useMemo(() => {
    if (!sel) return [] as MaterialItem[];
    if (!sel.cell) return elementMaterials(sel.el, items);
    return materialsByCell(sel.el, items).get(cellKey(sel.cell.row, sel.cell.col)) ?? [];
  }, [sel, items]);

  const panelProps = {
    roomCode, items, elements: layout.items,
    selectedId: sel?.el.id ?? null,
    dnd: false,
    onSelect: (id: string) => {
      const el = layout.items.find(i => i.id === id);
      if (el) setSel({ el, cell: null });
    },
    onItemRects: setItemAnchors,
    onHoverItem: (id: number | null) => setHoverKey(id === null ? null : String(id)),
    onDetail: (el: ItemElement) => setDetail({ el, cell: null }),
  };

  return (
    <div ref={workRef} className="relative flex flex-col gap-3 lg:flex-row">
      <div ref={wrapRef} data-testid="layout-stage"
        className="relative h-[46vh] min-h-[300px] w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-white lg:h-[560px]"
        style={{ touchAction: "none" }}>
        <Stage
          ref={stageRef} width={size.w} height={size.h}
          draggable onWheel={onWheel} onDragEnd={consumeStageDrag}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onClick={e => { if (e.target === e.target.getStage()) setSel(null); }}>
          <Layer x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            <GridShape layout={layout} scale={view.scale} />
            {layout.walls.map(el => <PosShape key={el.id} el={el} kind="wall" highlight={sel?.el.id === el.id} />)}
            {layout.doors.map(el => <PosShape key={el.id} el={el} kind="door" highlight={sel?.el.id === el.id} />)}
            {layout.windows.map(el => <PosShape key={el.id} el={el} kind="window" highlight={sel?.el.id === el.id} />)}
            {layout.items.map(el => (
              <ItemShape key={el.id} el={el} items={items} highlight={sel?.el.id === el.id} scale={view.scale}
                onCellHover={code => setHoverKey(code)}
                onCellClick={(_code, cell) => setSel({ el, cell })}
                onDblClick={() => setDetail({ el, cell: sel?.cell?.code ?? null })} />
            ))}
          </Layer>
        </Stage>

        <div className="absolute left-2 top-2 z-10 hidden rounded-lg bg-zinc-900/70 px-2 py-1 text-[11px] text-white lg:block">
          滚轮/双指缩放 · 拖动平移 · 点格位看物料 · 双击看正视详情
        </div>
        <button onClick={() => setShowLines(v => !v)} title="显示/隐藏物料连线"
          className={`absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs shadow-sm transition-colors ${
            showLines ? "bg-primary text-white" : "border border-border bg-surface/90 text-muted hover:text-sky-600"
          }`}>
          <Network className="h-3.5 w-3.5" />连线{showLines ? "开" : "关"}
        </button>
        <ZoomControls scale={view.scale} onZoom={zoomBy} onFit={fit}
          className="bottom-2 right-2 max-lg:bottom-auto max-lg:right-auto max-lg:left-2 max-lg:top-2" />

        {sel && (
          <div className="absolute bottom-2 left-2 z-10 w-[min(300px,calc(100%-1rem))] rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{sel.el.name}</div>
                <div className="text-[11px] text-faint">
                  {sel.cell ? cellLabelAt(sel.el, sel.cell.row, sel.cell.col) : cellSummary(sel.el)} · {cellItems.length} 种
                </div>
              </div>
              <button onClick={() => setSel(null)} aria-label="关闭" className="rounded p-0.5 text-faint hover:bg-surface-hover">
                <X className="h-4 w-4" />
              </button>
            </div>
            {cellItems.length === 0 ? (
              <p className="text-xs text-faint">该位置暂无物料</p>
            ) : (
              <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs">
                {cellItems.map(it => (
                  <li key={it.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{it.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">×{it.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setDetail({ el: sel.el, cell: sel.cell?.code ?? null })}
              className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-medium text-muted hover:border-sky-400 hover:text-sky-600">
              <LayoutGrid className="h-3.5 w-3.5" />正视细节视图
            </button>
          </div>
        )}
      </div>

      <MaterialsPanel {...panelProps} className="h-[560px] w-64 shrink-0 max-lg:hidden" />
      <MobileDrawer open={drawer} onToggle={() => setDrawer(v => !v)} title={`物料清单（${items.length}）`}>
        <MaterialsPanel {...panelProps} className="max-h-[45vh]" />
      </MobileDrawer>

      {showLines && <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />}

      {detail && (
        <ElementDetail element={detail.el} items={items} initialCell={detail.cell} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

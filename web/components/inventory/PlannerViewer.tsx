"use client";

/**
 * 平面图查看模式：只读渲染 LayoutJson（cm 网格 / 墙门窗 / 元素格位热点），
 * 支持缩放平移、格位点选查看物料、双击打开正视细节视图、物料连线，移动端面板折叠为抽屉。
 *
 * 定位入口：带 `initialElementId / focusItem` 从别的页面跳进来时（见布局页的查询参数），
 * 进入即选中该元素并把所查物料圈出来；不传这些参数时行为与以前完全一致。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import { Network } from "lucide-react";
import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";
import { GridShape, ItemShape, PosShape } from "./PlannerShapes";
import { MaterialsPanel } from "./MaterialsPanel";
import { ConnectionLines } from "./ConnectionLines";
import { ElementDetail } from "./ElementDetail";
import { MobileDrawer } from "./MobileDrawer";
import { ViewerFocusBanner, ViewerSelectionCard } from "./PlannerOverlays";
import { ZoomControls } from "./ZoomControls";
import { useMountingView } from "./useMountingState";
import { useCellCenters } from "./useCellCenters";
import { useStageView } from "./useStageView";
import { cellKey, cellLabelAt, type ElementCell } from "./elementGeometry";
import { elementMaterials, materialsByCell } from "./locationCodes";
import { findFocusCell, pickInitialElement } from "./viewerFocus";

interface PlannerViewerProps {
  layout: RoomLayout;
  roomCode: string;
  items: MaterialItem[];
  /** 初始选中的元素（带参数跳进来时定位；用户后续交互不受影响） */
  initialElementId?: string;
  /** 要高亮的元素：查询参数指定了元素时才传，交互式点选不会有这层定位圈 */
  focusElementId?: string;
  /** 所查询的物料：进入后高亮它并可滚动到它 */
  focusItem?: MaterialItem | null;
}

interface Selection {
  el: ItemElement;
  cell: ElementCell | null;
}

/** 元素的格位名（整体挂载返回 locCode）；null 表示没定位到格位 */
function cellLabelOf(el: ItemElement, cell: ElementCell | null): string | null {
  return cell ? cellLabelAt(el, cell.row, cell.col) : el.locCode || null;
}

export function PlannerViewer({ layout, roomCode, items, initialElementId, focusElementId, focusItem }: PlannerViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const focusCardRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // 初始值由入参决定（受控种子）；此后仍由页面内交互驱动，与原来一致
  const [sel, setSel] = useState<Selection | null>(() => {
    const el = pickInitialElement(layout.items, initialElementId);
    if (!el) return null;
    return { el, cell: findFocusCell(el, focusItem ?? null) };
  });
  const [detail, setDetail] = useState<{ el: ItemElement; cell: string | null } | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { setItemAnchors, setCellCenters, hoverKey, setHoverKey, lines } = useMountingView(items, layout.items);
  const { view, fit, zoomBy, onWheel, onTouchStart, onTouchMove, onTouchEnd, consumeStageDrag } =
    useStageView({ stageRef, width: size.w, height: size.h, contentW: layout.width, contentH: layout.height });
  useCellCenters(layout, items, view, stageRef, setCellCenters);

  // 所查物料在画布上的落点：用于把定位卡片滚到视野里（元素可能在画布外）
  const focusCellLabel = sel && focusItem ? cellLabelOf(sel.el, sel.cell) : null;
  useEffect(() => {
    if (!focusItem) return;
    // jsdom / 老浏览器可能没有 scrollIntoView
    focusCardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusItem, focusCellLabel]);

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
              <ItemShape key={el.id} el={el} items={items} scale={view.scale}
                highlight={sel?.el.id === el.id} focus={!!focusElementId && el.id === focusElementId}
                focusItem={el.id === focusElementId ? focusItem ?? null : null}
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

        {/* 跳转定位卡片：明确告诉用户"查的就是这件、它在哪个格位"（元素没定位到就不显示） */}
        {focusItem && sel && (
          <ViewerFocusBanner item={focusItem} element={sel.el} cell={sel.cell}
            roomCode={roomCode} containerRef={focusCardRef} />
        )}

        {sel && (
          <ViewerSelectionCard element={sel.el} cell={sel.cell} items={cellItems} focusItem={focusItem}
            onClose={() => setSel(null)}
            onDetail={() => setDetail({ el: sel.el, cell: sel.cell?.code ?? null })} />
        )}
      </div>

      <MaterialsPanel {...panelProps} className="h-[560px] w-64 shrink-0 max-lg:hidden" />
      <MobileDrawer open={drawer} onToggle={() => setDrawer(v => !v)} title={`物料清单（${items.length}）`}>
        <MaterialsPanel {...panelProps} className="max-h-[45vh]" />
      </MobileDrawer>

      {showLines && <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />}

      {detail && (
        <ElementDetail element={detail.el} items={items} initialCell={detail.cell}
          focusItemId={focusItem?.id ?? null} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

"use client";

/** 平面图查看模式：只读渲染 LayoutJson（墙/门/窗/元素 + 货架物料热点），可切换物料连线视图；点击物料可高亮对应元素 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import type { MaterialItem, RoomLayout } from "./layoutTypes";
import { GridShape, ItemShape, PosShape } from "./PlannerShapes";
import { MaterialsPanel } from "./MaterialsPanel";
import { ConnectionLines } from "./ConnectionLines";
import { useMountingView } from "./useMountingState";
import { useCellCenters } from "./useCellCenters";

interface PlannerViewerProps {
  layout: RoomLayout;
  roomCode: string;
  items: MaterialItem[];
}

export function PlannerViewer({ layout, roomCode, items }: PlannerViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [width, setWidth] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(false);
  const { setItemAnchors, setCellCenters, hoverKey, setHoverKey, lines } = useMountingView(items, layout.items);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const H = 560;
  const scale = width > 10 ? Math.min((width - 24) / layout.width, (H - 24) / layout.height) : 0;
  const offsetX = width > 10 ? (width - layout.width * scale) / 2 : 0;
  const offsetY = (H - layout.height * scale) / 2;
  const view = useMemo(() => ({ scale, x: offsetX, y: offsetY }), [scale, offsetX, offsetY]);
  useCellCenters(layout, items, view, stageRef, setCellCenters);

  return (
    <div ref={workRef} className="relative flex gap-3">
      <div ref={wrapRef} className="flex-1 relative overflow-hidden rounded-xl border border-border bg-white" style={{ height: H }}>
        {scale > 0 && (
          <Stage ref={stageRef} width={width} height={H}
            onClick={e => { if (e.target === e.target.getStage()) setHighlight(null); }}>
            <Layer x={offsetX} y={offsetY} scaleX={scale} scaleY={scale}>
              <GridShape layout={layout} />
              {layout.walls.map(el => (
                <PosShape key={el.id} el={el} kind="wall" highlight={highlight === el.id} />
              ))}
              {layout.doors.map(el => (
                <PosShape key={el.id} el={el} kind="door" highlight={highlight === el.id} />
              ))}
              {layout.windows.map(el => (
                <PosShape key={el.id} el={el} kind="window" highlight={highlight === el.id} />
              ))}
              {layout.items.map(el => (
                <ItemShape key={el.id} el={el} items={items} highlight={highlight === el.id}
                  onCellHover={code => setHoverKey(code)} />
              ))}
            </Layer>
          </Stage>
        )}
        <button onClick={() => setShowLines(v => !v)} title="显示/隐藏物料连线"
          className={`absolute right-2 top-2 z-10 rounded-lg px-2.5 py-1.5 text-xs shadow-sm transition-colors ${
            showLines
              ? "bg-primary text-white"
              : "border border-border bg-surface/90 text-muted hover:text-sky-600"
          }`}>
          连线{showLines ? "开" : "关"}
        </button>
      </div>
      <div className="h-[560px] w-64 shrink-0">
        <MaterialsPanel roomCode={roomCode} items={items} elements={layout.items}
          selectedId={highlight} onSelect={setHighlight} dnd={false}
          onItemRects={setItemAnchors} onHoverItem={id => setHoverKey(id === null ? null : String(id))} />
      </div>
      {showLines && <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />}
    </div>
  );
}

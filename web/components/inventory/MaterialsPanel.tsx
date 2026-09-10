"use client";

/** 物料挂载面板：搜索 + 按元素分组（格位元素按层位、整体挂载按编码）；上报条目坐标与 hover（连线视图用） */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { findElementByLoc, locationKey } from "./locationCodes";
import { MaterialsGroups, type MaterialGroup } from "./MaterialsGroups";

interface MaterialsPanelProps {
  roomCode: string;
  items: MaterialItem[];
  elements: ItemElement[];
  selectedId: string | null;
  onSelect: (elementId: string) => void;
  /** 查看模式只读：关闭拖拽挂载 */
  dnd?: boolean;
  onItemRects?: (rects: Map<number, { x: number; y: number }>) => void;
  onHoverItem?: (id: number | null) => void;
  onUnmount?: (id: number) => void;
  /** 点选挂载：进入待挂载状态，随后在画布上点格位完成 */
  onPick?: (item: MaterialItem) => void;
  pendingId?: number | null;
  onDetail?: (el: ItemElement) => void;
  className?: string;
}

export function MaterialsPanel({ roomCode, items, elements, selectedId, onSelect, dnd = true, onItemRects, onHoverItem, onUnmount, onPick, pendingId, onDetail, className = "" }: MaterialsPanelProps) {
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<number, HTMLElement>());

  const filtered = useMemo(
    () => (search ? items.filter(it => it.name.toLowerCase().includes(search.toLowerCase())) : items),
    [items, search]
  );

  const { groups, unlocated } = useMemo(() => {
    const byEl = new Map<string, MaterialItem[]>();
    const loose: MaterialItem[] = [];
    for (const it of filtered) {
      const loc = it.locationCode || "";
      const el = findElementByLoc(elements, loc);
      if (el && locationKey(el, loc)) {
        const list = byEl.get(el.id);
        if (list) list.push(it);
        else byEl.set(el.id, [it]);
      } else {
        loose.push(it);
      }
    }
    const groups: MaterialGroup[] = elements
      .filter(e => byEl.has(e.id))
      .map(e => ({ element: e, items: byEl.get(e.id)! }));
    return { groups, unlocated: loose };
  }, [filtered, elements]);

  // 上报条目中心（视口坐标）：条目/搜索变化、面板滚动、窗口缩放时重测
  const report = useCallback(() => {
    if (!onItemRects) return;
    const m = new Map<number, { x: number; y: number }>();
    for (const [id, el] of chipRefs.current) {
      const r = el.getBoundingClientRect();
      m.set(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    onItemRects(m);
  }, [onItemRects]);

  useEffect(() => { report(); }, [report, filtered]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.addEventListener("scroll", report);
    window.addEventListener("resize", report);
    return () => {
      el.removeEventListener("scroll", report);
      window.removeEventListener("resize", report);
    };
  }, [report]);

  const setChipRef = (id: number) => (el: HTMLElement | null) => {
    if (el) chipRefs.current.set(id, el);
    else chipRefs.current.delete(id);
  };

  const handleUnmount = (item: MaterialItem) => {
    if (!confirm(`从 ${item.locationCode} 卸下「${item.name}」？`)) return;
    onUnmount?.(item.id);
  };

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-border bg-surface ${className}`}>
      <div className="border-b border-border p-3 pb-2">
        <h3 className="mb-2 text-xs font-semibold text-muted">
          物料挂载（{items.length}）{roomCode ? ` · ${roomCode}` : ""}
        </h3>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物料…"
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 && <p className="text-sm text-faint">该房间暂无物料</p>}
        <MaterialsGroups
          groups={groups} unlocated={unlocated} selectedId={selectedId} pendingId={pendingId ?? null}
          dnd={dnd} onSelect={onSelect} onDetail={onDetail} onPick={onPick}
          onUnmount={onUnmount ? handleUnmount : undefined} onHover={onHoverItem} setChipRef={setChipRef} />
      </div>
    </div>
  );
}

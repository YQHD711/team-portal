"use client";

/** 物料挂载面板：搜索 + 按货架分组；条目可拖拽挂载、已挂载右键卸下；上报条目坐标与 hover（连线视图用） */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { MaterialChip } from "./MaterialsDnd";

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
}

interface MatchedGroup {
  element: ItemElement;
  items: MaterialItem[];
}

export function MaterialsPanel({ roomCode, items, elements, selectedId, onSelect, dnd = true, onItemRects, onHoverItem, onUnmount }: MaterialsPanelProps) {
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<number, HTMLElement>());

  const filtered = useMemo(
    () => (search ? items.filter(it => it.name.toLowerCase().includes(search.toLowerCase())) : items),
    [items, search]
  );

  const { matched, unlocated } = useMemo(() => {
    const byEl = new Map<string, MaterialItem[]>();
    const loose: MaterialItem[] = [];
    for (const it of filtered) {
      const loc = it.locationCode || "";
      const parts = loc.split("-");
      // 四段编码 → 货架格子；否则匹配非货架元素（完整 locCode 或以 locCode- 开头的兼容格式）
      let el: ItemElement | undefined;
      if (parts.length >= 4) {
        el = elements.find(e => e.type === "shelf" && e.locCode === `${roomCode}-${parts[1]}`);
      }
      if (!el) {
        el = elements.find(e => e.type !== "shelf" && e.locCode && (loc === e.locCode || loc.startsWith(e.locCode + "-")));
      }
      if (el) {
        const list = byEl.get(el.id);
        if (list) list.push(it);
        else byEl.set(el.id, [it]);
      } else {
        loose.push(it);
      }
    }
    const matched: MatchedGroup[] = [...byEl].map(([id, list]) => ({
      element: elements.find(e => e.id === id)!,
      items: list,
    }));
    return { matched, unlocated: loose };
  }, [roomCode, filtered, elements]);

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

  const handleUnmount = (id: number) => {
    const it = items.find(i => i.id === id);
    if (!it || !confirm(`从 ${it.locationCode} 卸下「${it.name}」？`)) return;
    onUnmount?.(id);
  };

  return (
    <div ref={boxRef} className="w-64 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto">
      <h3 className="text-xs font-semibold text-muted mb-2">物料挂载（{items.length}）</h3>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物料…"
        className="mb-2 w-full rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />

      {items.length === 0 && <p className="text-sm text-faint">该房间暂无物料</p>}

      {matched.map(({ element, items: list }) => (
        <div key={element.id} className="mb-3">
          <button
            onClick={() => onSelect(element.id)}
            title="点击在画布上高亮该元素"
            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors ${
              selectedId === element.id
                ? "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300"
                : "hover:bg-surface-hover"
            }`}>
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
            {element.name}
            <span className="font-mono text-[10px] text-faint">{element.locCode}</span>
            <span className="flex-1 text-right text-faint">{list.reduce((s, i) => s + i.quantity, 0)}</span>
          </button>
          <div className="mt-1 space-y-0.5 pl-3">
            {list.map(it => {
              const parts = (it.locationCode || "").split("-");
              // 货架显示层位；非货架元素整体挂载，显示完整 locCode
              const suffix = element.type === "shelf" ? `${parts[2]}层${parts[3]}位` : it.locationCode;
              return (
                <MaterialChip key={it.id} item={it} onRef={setChipRef(it.id)} onHover={onHoverItem}
                  onUnmount={handleUnmount} onClick={() => onSelect(element.id)} draggable={dnd}
                  title={dnd ? `${it.locationCode} ${it.name} ×${it.quantity}（拖拽可换位，右键卸下）` : `${it.locationCode} ${it.name} ×${it.quantity}`}
                  className="flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] text-muted hover:bg-surface-hover/60">
                  <span className="truncate flex-1">{it.name}</span>
                  <span className="font-mono text-[10px] text-faint">{suffix}</span>
                  <span className="font-semibold">×{it.quantity}</span>
                </MaterialChip>
              );
            })}
          </div>
        </div>
      ))}

      {unlocated.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-xs text-faint mb-1">未定位（{unlocated.length}）</p>
          <div className="flex flex-wrap gap-1">
            {unlocated.map(it => (
              <MaterialChip key={it.id} item={it} onRef={setChipRef(it.id)} onHover={onHoverItem} draggable={dnd}
                title={dnd ? `${it.name} ×${it.quantity} — 拖拽到画布元素上挂载` : `${it.name} ×${it.quantity}`}
                className={`rounded-md bg-surface-subtle px-1.5 py-0.5 text-[11px] text-muted ${dnd ? "cursor-grab" : ""}`}>
                {it.name} ×{it.quantity}
              </MaterialChip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

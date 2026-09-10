"use client";

/** 物料面板列表：按元素分组 + 未定位区；条目支持拖拽挂载、点选移动、卸下（右键亦可） */
import { LayoutGrid, MoveRight, Undo2 } from "lucide-react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { cellSummary, usesCells } from "./layoutTypes";
import { cellLabelFromLoc } from "./elementGeometry";
import { MaterialChip } from "./MaterialsDnd";

export interface MaterialGroup {
  element: ItemElement;
  items: MaterialItem[];
}

interface Props {
  groups: MaterialGroup[];
  unlocated: MaterialItem[];
  selectedId: string | null;
  /** 处于「待挂载」状态的物料 id */
  pendingId?: number | null;
  dnd: boolean;
  onSelect: (elementId: string) => void;
  onDetail?: (el: ItemElement) => void;
  onPick?: (item: MaterialItem) => void;
  onUnmount?: (item: MaterialItem) => void;
  onHover?: (id: number | null) => void;
  setChipRef: (id: number) => (el: HTMLElement | null) => void;
}

const chipCls = "flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] text-muted hover:bg-surface-hover/60";

export function MaterialsGroups(props: Props) {
  const { groups, unlocated, selectedId, pendingId, dnd, onSelect, onDetail, onPick, onUnmount, onHover, setChipRef } = props;
  return (
    <>
      {groups.map(({ element, items }) => {
        const total = items.reduce((s, i) => s + i.quantity, 0);
        const split = usesCells(element);
        return (
          <div key={element.id} className="mb-3">
            <div className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              selectedId === element.id ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "hover:bg-surface-hover"
            }`}>
              <button onClick={() => onSelect(element.id)} title="点击在画布上高亮该元素"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span className="truncate">{element.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">{element.locCode}</span>
              </button>
              <span className="shrink-0 text-[10px] text-faint">{split ? cellSummary(element) : ""}</span>
              <span className="shrink-0 tabular-nums text-faint">{total}</span>
              {onDetail && (
                <button onClick={() => onDetail(element)} title="正视细节视图"
                  className="shrink-0 rounded p-0.5 text-faint hover:bg-surface-hover hover:text-sky-600">
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1 space-y-0.5 pl-3">
              {items.map(it => (
                <MaterialChip key={it.id} item={it} onRef={setChipRef(it.id)} onHover={onHover}
                  onUnmount={onUnmount ? () => onUnmount(it) : undefined} draggable={dnd}
                  onClick={() => onSelect(element.id)}
                  title={`${it.locationCode} ${it.name} ×${it.quantity}${dnd ? "（拖拽或点“移动”换位，右键卸下）" : ""}`}
                  className={`${chipCls} ${pendingId === it.id ? "bg-emerald-100 dark:bg-emerald-950 ring-1 ring-emerald-400" : ""}`}>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {split ? cellLabelFromLoc(element, it.locationCode || "") : it.locationCode}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">×{it.quantity}</span>
                  {dnd && onPick && (
                    <button onClick={e => { e.stopPropagation(); onPick(it); }} title="点选挂载：点击后到画布上点目标格位"
                      className="shrink-0 rounded p-0.5 text-faint hover:bg-surface-hover hover:text-emerald-600">
                      <MoveRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onUnmount && (
                    <button onClick={e => { e.stopPropagation(); onUnmount(it); }} title="从当前位置卸下"
                      className="shrink-0 rounded p-0.5 text-faint hover:bg-surface-hover hover:text-danger">
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </MaterialChip>
              ))}
            </div>
          </div>
        );
      })}

      {unlocated.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="mb-1 text-xs text-faint">未定位（{unlocated.length}）</p>
          <div className="flex flex-wrap gap-1">
            {unlocated.map(it => (
              <MaterialChip key={it.id} item={it} onRef={setChipRef(it.id)} onHover={onHover} draggable={dnd}
                title={dnd ? `${it.name} ×${it.quantity} — 拖拽或点「移动」后到画布上挂载` : `${it.name} ×${it.quantity}`}
                onClick={dnd && onPick ? () => onPick(it) : undefined}
                className={`rounded-md bg-surface-subtle px-1.5 py-0.5 text-[11px] text-muted ${
                  dnd ? "cursor-grab" : ""
                } ${pendingId === it.id ? "ring-1 ring-emerald-400" : ""}`}>
                {it.name} ×{it.quantity}
              </MaterialChip>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

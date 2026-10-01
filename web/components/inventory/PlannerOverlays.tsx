"use client";

/**
 * 查看器的两个定位相关浮层：
 * 1. 所查物料定位卡片（顶部）——明确告诉用户「查的就是这件、它在哪个格位」；
 * 2. 选中元素/格位的卡片（左下）——原有的「点格位看物料」，多出一个高亮所查物料的分支。
 *
 * 不传 focusItem 时渲染结果与改动前一致（浮层内容不依赖它）。
 */
import { Crosshair, LayoutGrid, X } from "lucide-react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { cellSummary } from "./layoutTypes";
import { cellLabelAt, type ElementCell } from "./elementGeometry";

interface FocusBannerProps {
  item: MaterialItem;
  element: ItemElement | null;
  cell: ElementCell | null;
  roomCode: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/** 跳转定位卡片：所查物料 + 所在元素/格位/库位编码 */
export function ViewerFocusBanner({ item, element, cell, roomCode, containerRef }: FocusBannerProps) {
  const cellLabel = element && cell ? cellLabelAt(element, cell.row, cell.col) : element?.locCode || null;
  return (
    <div ref={containerRef} data-testid="layout-focus-card"
      className="absolute left-1/2 top-2 z-20 w-[min(340px,calc(100%-1rem))] -translate-x-1/2 rounded-xl border border-amber-400/70 bg-amber-50/95 p-2.5 shadow-lg backdrop-blur dark:bg-amber-950/80">
      <div className="flex items-start gap-2">
        <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 text-xs">
          <div className="font-medium text-amber-900 dark:text-amber-200">
            已定位：
            <span data-testid="layout-focus-item" className="font-semibold">{item.name}</span>
            <span className="ml-1.5 font-mono opacity-70">×{item.quantity}</span>
          </div>
          <div className="mt-0.5 text-amber-800/80 dark:text-amber-300/80">
            {element ? element.name : roomCode}
            {cellLabel ? ` · ${cellLabel}` : ""}
            {item.locationCode ? ` · ${item.locationCode}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SelectionCardProps {
  element: ItemElement;
  cell: ElementCell | null;
  items: MaterialItem[];
  /** 所查物料：在清单里高亮（不带参数时传 null/不传，渲染与以前一致） */
  focusItem?: MaterialItem | null;
  onClose: () => void;
  onDetail: () => void;
}

/** 选中元素/格位卡片：格位清单 + 正视细节视图入口 */
export function ViewerSelectionCard({ element, cell, items, focusItem, onClose, onDetail }: SelectionCardProps) {
  return (
    <div data-testid="layout-selection-card"
      className="absolute bottom-2 left-2 z-10 w-[min(300px,calc(100%-1rem))] rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{element.name}</div>
          <div className="text-[11px] text-faint">
            {cell ? cellLabelAt(element, cell.row, cell.col) : cellSummary(element)} · {items.length} 种
          </div>
        </div>
        <button onClick={onClose} aria-label="关闭" className="rounded p-0.5 text-faint hover:bg-surface-hover">
          <X className="h-4 w-4" />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-faint">该位置暂无物料</p>
      ) : (
        <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs">
          {items.map(it => (
            <li key={it.id} data-testid={`cell-item-${it.id}`}
              className={`flex items-center gap-2 rounded px-1 ${
                it.id === focusItem?.id ? "bg-amber-100 font-medium text-amber-900 ring-1 ring-amber-400 dark:bg-amber-900/50 dark:text-amber-100" : ""
              }`}>
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">×{it.quantity}</span>
            </li>
          ))}
        </ul>
      )}
      <button onClick={onDetail}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-medium text-muted hover:border-sky-400 hover:text-sky-600">
        <LayoutGrid className="h-3.5 w-3.5" />正视细节视图
      </button>
    </div>
  );
}

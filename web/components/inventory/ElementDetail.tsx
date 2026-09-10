"use client";

/**
 * 元素正视细节视图：把「行 × 列」格位按正视排布展开（行自上而下、列自左而右），
 * 点格位查看该格物料清单；立体货架=层×位、柜子=层×格、桌面=排×区、1×1=整体。
 */
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { ELEMENT_DEFS, cellAxes, cellSummary, colsOf, rowsOf, usesCells } from "./layoutTypes";
import { cellKey, cellLabelAt, cellSizeCm } from "./elementGeometry";
import { elementStats, materialsByCell } from "./locationCodes";
import { cellClasses } from "./cellColors";
import { useLowStock } from "./LowStockProvider";
import { formatArea, formatCellDims, formatDims } from "./layoutUnits";

interface ElementDetailProps {
  element: ItemElement;
  items: MaterialItem[];
  /** 初始选中的格位编码（从画布点进来时定位） */
  initialCell?: string | null;
  onClose: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-2.5 py-1.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ElementDetail({ element, items, initialCell, onClose }: ElementDetailProps) {
  const def = ELEMENT_DEFS[element.type];
  const { threshold } = useLowStock();
  const split = usesCells(element);
  const { rowLabel, colLabel } = cellAxes(element);
  const rows = split ? rowsOf(element) : 1;
  const cols = split ? colsOf(element) : 1;
  const size = cellSizeCm(element);
  const stats = useMemo(() => elementStats(element, items), [element, items]);
  const grouped = useMemo(() => materialsByCell(element, items), [element, items]);
  const [selected, setSelected] = useState<string | null>(initialCell ?? null);
  const selectedParts = (selected || "").split("-");
  const selectedRow = parseInt(selectedParts[2] ?? "", 10);
  const selectedCol = parseInt(selectedParts[3] ?? "", 10);
  const selectedKey = Number.isFinite(selectedRow) && Number.isFinite(selectedCol)
    ? cellKey(selectedRow - 1, selectedCol - 1)
    : cellKey(0, 0);
  const selectedCell = split
    ? cellLabelAt(element, Number.isFinite(selectedRow) ? selectedRow - 1 : 0, Number.isFinite(selectedCol) ? selectedCol - 1 : 0)
    : element.locCode || "整体";
  const selectedItems = grouped.get(selectedKey) ?? [];
  const Icon = def.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-black/50 backdrop-blur-sm sm:items-start sm:p-4"
      onClick={onClose}>
      <div className="flex w-full flex-col rounded-none bg-surface shadow-xl sm:my-auto sm:max-w-3xl sm:rounded-2xl border border-border"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold sm:text-lg">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${def.color}22`, color: def.color }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="truncate">{element.name}</span>
              <span className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-normal text-muted">{def.label}</span>
            </h3>
            <p className="mt-1 font-mono text-xs text-faint">
              {element.locCode || "未设库位编码"} · {formatDims(element.w, element.h)} · {formatArea(element.w, element.h)}
            </p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="shrink-0 rounded-lg p-1.5 hover:bg-surface-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <Stat label="格位规格" value={cellSummary(element)} />
          <Stat label="单格尺寸（图面）" value={size ? formatCellDims(size.w, size.h, colLabel) : "—"} />
          <Stat label="占用格位" value={split ? `${stats.usedCells}/${stats.totalCells}` : stats.usedCells > 0 ? "已用" : "空"} />
          <Stat label="物料数量" value={`${stats.kinds} 种 · ${stats.total} 件`} />
        </div>

        <div className="px-4 pb-2">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {element.type === "shelf" ? "正视（层 × 位）" : `正视（${rowLabel} × ${colLabel}）`}
            </h4>
            <span className="text-[11px] text-faint">
              {split && cols > 4 ? `左右滑动查看全部 ${cols} ${colLabel} · ` : ""}点格位查看物料
            </span>
          </div>
          <div className="max-h-[42vh] overflow-auto rounded-xl border border-border bg-background p-2">
            <div className="space-y-1.5">
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-right text-[10px] text-faint">{split ? `${r + 1}${rowLabel}` : ""}</span>
                  <div className="grid flex-1 gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(${split ? 56 : 120}px, 1fr))` }}>
                    {Array.from({ length: cols }, (_, c) => {
                      const list = grouped.get(cellKey(r, c)) ?? [];
                      const qty = list.reduce((s, i) => s + i.quantity, 0);
                      const code = split && element.locCode ? `${element.locCode}-${r + 1}-${String(c + 1).padStart(2, "0")}` : element.locCode || "";
                      const isSel = split && selectedKey === cellKey(r, c);
                      return (
                        <button key={c} type="button"
                          onClick={() => setSelected(split ? code : null)}
                          title={`${cellLabelAt(element, r, c)}${list.length ? `\n${list.map(i => `${i.name} ×${i.quantity}`).join("\n")}` : "\n空位"}`}
                          className={`flex min-h-[46px] flex-col items-center justify-center rounded-lg border px-1 py-1 text-center transition-shadow ${cellClasses(qty, threshold)} ${isSel ? "ring-2 ring-primary" : ""}`}>
                          <span className="text-sm font-bold leading-none tabular-nums">{qty > 0 ? qty : "—"}</span>
                          {split && <span className="mt-0.5 w-full truncate text-[9px] leading-tight opacity-80">{c + 1}{colLabel}</span>}
                          {list.length > 0 && (
                            <span className="mt-0.5 w-full truncate text-[10px] leading-tight">{list[0].name}{list.length > 1 ? ` +${list.length - 1}` : ""}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border p-4">
          <h4 className="mb-2 text-sm font-semibold">
            格位明细 · {selectedCell}
            {selectedItems.length > 0 && <span className="ml-2 font-normal text-faint">{selectedItems.length} 种</span>}
          </h4>
          {selectedItems.length === 0 ? (
            <p className="text-sm text-faint">{split ? "该格位为空，可把物料拖拽到画布对应格位挂载" : "该元素暂无物料"}</p>
          ) : (
            <ul className="space-y-1">
              {selectedItems.map(it => (
                <li key={it.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.category && <span className="shrink-0 text-[11px] text-faint">{it.category}</span>}
                  <span className="shrink-0 font-mono text-[11px] text-faint">{it.locationCode}</span>
                  <span className="shrink-0 font-semibold tabular-nums">×{it.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

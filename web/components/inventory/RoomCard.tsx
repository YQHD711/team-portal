"use client";

/** 房间卡片：平面尺寸（cm）、元素构成、物料种类/数量与低库存预警 */
import { useMemo } from "react";
import type { MaterialItem } from "./layoutTypes";
import { layoutSummary, parseLayout } from "./layoutCodec";
import { formatDims } from "./layoutUnits";
import { LOW_THRESHOLD } from "./inventoryTypes";
import type { RoomLayoutRow } from "./layoutRow";

interface RoomCardProps {
  row: RoomLayoutRow;
  items: MaterialItem[];
  isStaff: boolean;
  onOpen: () => void;
}

export function RoomCard({ row, items, isStaff, onOpen }: RoomCardProps) {
  const layout = useMemo(() => parseLayout(row.layoutJson), [row.layoutJson]);
  const stats = useMemo(() => {
    const list = items.filter(i => (i.locationCode || "").split("-")[0] === row.roomCode);
    return {
      kinds: list.length,
      totalQty: list.reduce((s, i) => s + i.quantity, 0),
      lowCount: list.filter(i => i.quantity < LOW_THRESHOLD).length,
    };
  }, [items, row.roomCode]);

  return (
    <button onClick={onOpen}
      className="relative rounded-xl border border-border bg-surface p-4 text-left transition-all hover:border-sky-400 hover:shadow-sm">
      {isStaff && stats.lowCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex items-center rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">
          {stats.lowCount} 预警
        </span>
      )}
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{row.roomName}</span>
        <span className="shrink-0 font-mono text-xs text-faint">{row.roomCode}</span>
      </div>
      <p className="mb-1 text-xs text-muted">
        {layout ? `${formatDims(layout.width, layout.height)} · ${layoutSummary(layout)}` : "尚未配置平面图"}
      </p>
      {row.description && <p className="mb-2 truncate text-[11px] text-faint">{row.description}</p>}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-base font-bold tabular-nums">{stats.kinds}</div><div className="text-[10px] text-faint">物料种类</div></div>
        <div><div className="text-base font-bold tabular-nums">{stats.totalQty}</div><div className="text-[10px] text-faint">数量</div></div>
        <div><div className="text-base font-bold tabular-nums">{layout?.items.length ?? 0}</div><div className="text-[10px] text-faint">元素</div></div>
      </div>
    </button>
  );
}

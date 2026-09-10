"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { ArrowLeft, LayoutGrid, Pencil } from "lucide-react";
import type { MaterialItem } from "@/components/inventory/layoutTypes";
import { parseLayout } from "@/components/inventory/layoutCodec";
import { formatDims } from "@/components/inventory/layoutUnits";
import { RoomCard } from "@/components/inventory/RoomCard";
import { locationRoom } from "@/components/inventory/locCode";
import type { RoomLayoutRow } from "@/components/inventory/layoutRow";

// react-konva 依赖 Canvas，SSR 时不可用，关闭服务端渲染
const RoomPlanner = dynamic(() => import("@/components/inventory/RoomPlanner").then(m => m.RoomPlanner), { ssr: false });
const PlannerViewer = dynamic(() => import("@/components/inventory/PlannerViewer").then(m => m.PlannerViewer), { ssr: false });

export default function StorageLayoutPage() {
  const [layouts, setLayouts] = useState<RoomLayoutRow[]>([]);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const { user } = useCurrentUser();
  const role = user?.role ?? "";
  const [selected, setSelected] = useState<RoomLayoutRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(
    (): Promise<[RoomLayoutRow[], MaterialItem[]]> =>
      Promise.all([
        api.get<RoomLayoutRow[]>("/api/storage/layouts").catch(() => [] as RoomLayoutRow[]),
        api.get<MaterialItem[]>("/api/inventory").catch(() => [] as MaterialItem[]),
      ]),
    []
  );

  useEffect(() => {
    fetchData().then(([ls, it]) => { setLayouts(ls); setItems(it); setLoading(false); });
  }, [fetchData]);

  const roomItems = useMemo(
    () => (selected ? items.filter(i => locationRoom(i.locationCode) === selected.roomCode) : []),
    [items, selected]
  );
  const isStaff = role === "admin" || role === "部长";
  const floors = [...new Set(layouts.map(l => l.floor))].sort((a, b) => a - b);
  const parsedLayout = useMemo(() => (selected ? parseLayout(selected.layoutJson) : null), [selected]);

  const handleSaved = () => {
    fetchData().then(([ls, it]) => {
      setLayouts(ls);
      setItems(it);
      if (selected) setSelected(ls.find(l => l.id === selected.id) ?? null);
    });
    setEditing(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24 lg:pb-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">物料布局</h1>
        <p className="text-sm text-muted">
          {layouts.length} 个房间 · {items.length} 种物料 · 尺寸单位统一为 cm
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-faint">
          <LayoutGrid className="mb-2 h-8 w-8 opacity-40" />加载中...
        </div>
      ) : selected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button onClick={() => { setSelected(null); setEditing(false); }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-hover hover:text-sky-600">
                <ArrowLeft className="h-4 w-4" />楼层概览
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">/</span>
              <span className="truncate text-sm font-medium">{selected.roomCode} {selected.roomName}</span>
              {parsedLayout && (
                <span className="hidden shrink-0 text-xs text-faint sm:inline">
                  {formatDims(parsedLayout.width, parsedLayout.height)} · {parsedLayout.items.length} 个元素
                </span>
              )}
            </div>
            {!editing && isStaff && (
              <button onClick={() => setEditing(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover">
                <Pencil className="h-4 w-4" />编辑平面图
              </button>
            )}
          </div>

          {editing ? (
            <RoomPlanner layout={selected} onSaved={handleSaved} onBack={() => setEditing(false)} />
          ) : parsedLayout ? (
            <PlannerViewer layout={parsedLayout} roomCode={selected.roomCode} items={roomItems} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface py-20">
              <LayoutGrid className="h-10 w-10 text-zinc-300" />
              <p className="px-4 text-center text-sm text-muted">
                {isStaff ? "尚未配置平面图，点击「编辑平面图」开始绘制" : "该房间尚未配置平面图"}
              </p>
              {isStaff && (
                <button onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover">
                  <Pencil className="h-4 w-4" />编辑平面图
                </button>
              )}
            </div>
          )}
        </div>
      ) : layouts.length === 0 ? (
        <div className="py-16 text-center text-faint">暂无房间布局</div>
      ) : (
        floors.map(floor => (
          <div key={floor}>
            <h2 className="mb-2 text-sm font-semibold text-muted">{floor}F</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {layouts.filter(l => l.floor === floor).map(l => (
                <RoomCard key={l.id} row={l} items={items} isStaff={isStaff} onOpen={() => setSelected(l)} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

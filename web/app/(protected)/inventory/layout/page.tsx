"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { ArrowLeft, LayoutGrid, Pencil } from "lucide-react";
import type { MaterialItem } from "@/components/inventory/layoutTypes";
import { parseLayout } from "@/components/inventory/layoutTypes";
import type { RoomLayoutRow } from "@/components/inventory/RoomPlanner";

// react-konva 依赖 Canvas，SSR 时不可用，关闭服务端渲染
const RoomPlanner = dynamic(() => import("@/components/inventory/RoomPlanner").then(m => m.RoomPlanner), { ssr: false });
const PlannerViewer = dynamic(() => import("@/components/inventory/PlannerViewer").then(m => m.PlannerViewer), { ssr: false });

const LOW_THRESHOLD = 3;

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

  const roomItems = (roomCode: string) => items.filter(i => (i.locationCode || "").split("-")[0] === roomCode);
  const stats = (roomCode: string) => {
    const list = roomItems(roomCode);
    return {
      kinds: list.length,
      totalQty: list.reduce((s, i) => s + i.quantity, 0),
      lowCount: list.filter(i => i.quantity < LOW_THRESHOLD).length,
    };
  };

  const isStaff = role === "admin" || role === "部长";
  const floors = [...new Set(layouts.map(l => l.floor))].sort((a, b) => a - b);
  const parsedLayout = useMemo(
    () => (selected ? parseLayout(selected.layoutJson) : null),
    [selected]
  );

  const handleSaved = () => {
    fetchData().then(([ls, it]) => {
      setLayouts(ls);
      setItems(it);
      if (selected) setSelected(ls.find(l => l.id === selected.id) ?? null);
    });
    setEditing(false);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">物料布局</h1>
          <p className="text-sm text-muted">{layouts.length} 个房间 · {items.length} 种物料</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-faint">
          <LayoutGrid className="h-8 w-8 mb-2 opacity-40" />加载中...
        </div>
      ) : selected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { setSelected(null); setEditing(false); }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:text-sky-600 hover:bg-surface-hover">
                <ArrowLeft className="h-4 w-4" />楼层概览
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">/</span>
              <span className="text-sm font-medium">{selected.roomCode} {selected.roomName}</span>
            </div>
            {!editing && isStaff && (
              <button onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover shadow-sm">
                <Pencil className="h-4 w-4" />编辑平面图
              </button>
            )}
          </div>

          {editing ? (
            <RoomPlanner layout={selected} onSaved={handleSaved} onBack={() => setEditing(false)} />
          ) : parsedLayout ? (
            <PlannerViewer layout={parsedLayout} roomCode={selected.roomCode} items={roomItems(selected.roomCode)} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface py-20">
              <LayoutGrid className="h-10 w-10 text-zinc-300" />
              <p className="text-sm text-muted">
                {isStaff ? "尚未配置平面图，点击「编辑平面图」开始绘制" : "该房间尚未配置平面图"}
              </p>
              {isStaff && (
                <button onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover shadow-sm">
                  <Pencil className="h-4 w-4" />编辑平面图
                </button>
              )}
            </div>
          )}
        </div>
      ) : layouts.length === 0 ? (
        <div className="text-center py-16 text-faint">暂无房间布局</div>
      ) : (
        floors.map(floor => (
          <div key={floor}>
            <h2 className="text-sm font-semibold text-muted mb-2">{floor}F</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {layouts.filter(l => l.floor === floor).map(l => {
                const s = stats(l.roomCode);
                return (
                  <button key={l.id} onClick={() => setSelected(l)}
                    className="relative text-left rounded-xl border border-border bg-surface p-4 hover:border-sky-400 hover:shadow-sm transition-all">
                    {isStaff && s.lowCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 inline-flex items-center rounded-full bg-danger text-white text-xs font-bold px-2 py-0.5">
                        {s.lowCount} 预警
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold">{l.roomName}</span>
                      <span className="text-xs font-mono text-faint">{l.roomCode}</span>
                    </div>
                    <p className="text-xs text-muted mb-3">
                      {l.layoutJson ? "平面图模式" : `${l.cabinetCount}架 × ${l.shelfCount}层 × ${l.positionCount}位`}
                      {l.description ? ` · ${l.description}` : ""}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div><div className="text-base font-bold">{s.kinds}</div><div className="text-[10px] text-faint">种类</div></div>
                      <div><div className="text-base font-bold">{s.totalQty}</div><div className="text-[10px] text-faint">数量</div></div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

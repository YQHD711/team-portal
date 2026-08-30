"use client";

/** 房间平面图编辑器：组合工具栏/元素面板/画布/物料面板，管理历史与保存；物料可拖拽挂载、连线视图 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ElementKind, ItemElement, PosElement, RoomLayout } from "./layoutTypes";
import { createElement, defaultLayout, layoutToJson, parseLayout } from "./layoutTypes";
import { ElementPanel } from "./ElementPanel";
import { PlannerCanvas } from "./PlannerCanvas";
import { PlannerToolbar } from "./PlannerToolbar";
import { MaterialsPanel } from "./MaterialsPanel";
import { ConnectionLines } from "./ConnectionLines";
import { useMountingState } from "./useMountingState";
import { PropertyDialog } from "./PropertyPanel";
import { usePlannerShortcuts } from "./usePlannerShortcuts";
import { historyReducer, removeElem, type HistState } from "./usePlannerHistory";

/** 与后端 StorageLayout 一致的记录类型 */
export interface RoomLayoutRow {
  id: number;
  roomCode: string;
  roomName: string;
  floor: number;
  cabinetCount: number;
  shelfCount: number;
  positionCount: number;
  description?: string;
  updatedAt: string;
  layoutJson?: string | null;
}

interface RoomPlannerProps {
  layout: RoomLayoutRow;
  onSaved: () => void;
  onBack: () => void;
}

export function RoomPlanner({ layout: row, onSaved, onBack }: RoomPlannerProps) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, () => ({
    layout: parseLayout(row.layoutJson) ?? defaultLayout(row.roomCode),
    past: [],
    future: [],
  }));
  const { layout } = hist;
  const [selected, setSelected] = useState<string | null>(null);
  const [roomName, setRoomName] = useState(row.roomName);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);
  const { items, applyLocation, setItemAnchors, setCellCenters, hoverKey, setHoverKey, lines } =
    useMountingState(row.roomCode, layout.items);

  const commit = useCallback((next: RoomLayout) => dispatch({ type: "commit", next }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  // ── 元素增删改 ──
  const patchElem = (el: PosElement | ItemElement): RoomLayout => {
    const cur = hist.layout;
    const repl = <T extends PosElement>(arr: T[]): T[] => arr.map(e => (e.id === el.id ? (el as T) : e));
    if (cur.walls.some(e => e.id === el.id)) return { ...cur, walls: repl(cur.walls) };
    if (cur.doors.some(e => e.id === el.id)) return { ...cur, doors: repl(cur.doors) };
    if (cur.windows.some(e => e.id === el.id)) return { ...cur, windows: repl(cur.windows) };
    return { ...cur, items: repl(cur.items) };
  };
  const addElement = (kind: ElementKind) => {
    const cur = hist.layout;
    const el = createElement(kind, cur, cur.items.length + cur.walls.length + cur.doors.length + cur.windows.length);
    const next = "type" in el
      ? { ...cur, items: [...cur.items, el as ItemElement] }
      : el.id.startsWith("wall-")
        ? { ...cur, walls: [...cur.walls, el as PosElement] }
        : el.id.startsWith("door-")
          ? { ...cur, doors: [...cur.doors, el as PosElement] }
          : { ...cur, windows: [...cur.windows, el as PosElement] };
    commit(next);
    setSelected(el.id);
  };
  const deleteSelected = () => {
    if (!selected) return;
    commit(removeElem(hist.layout, selected));
    setSelected(null);
  };
  const clearAll = () => {
    if (!confirm("清空画布上的所有元素？")) return;
    commit({ ...hist.layout, walls: [], doors: [], windows: [], items: [] });
    setSelected(null);
  };
  const onDragEnd = (el: PosElement | ItemElement) => commit(patchElem(el));
  const onTransformEnd = (el: PosElement | ItemElement) => commit(patchElem(el));
  const onPropertySave = (el: PosElement | ItemElement) => { commit(patchElem(el)); setEditId(null); };
  const findElem = (id: string): PosElement | ItemElement | null => {
    const cur = hist.layout;
    return [...cur.walls, ...cur.doors, ...cur.windows, ...cur.items].find(e => e.id === id) ?? null;
  };

  usePlannerShortcuts(selected, undo, redo, deleteSelected);

  // ── 物料挂载/卸下：PUT locationCode 后按响应刷新列表与画布热点 ──
  const mountMaterial = async (id: number, code: string) => {
    if (!(await applyLocation(id, code))) setMsg(`挂载失败：${code}`);
  };
  const unmountMaterial = (id: number) => {
    applyLocation(id, "").then(ok => { if (!ok) setMsg("卸下失败，请重试"); });
  };
  // 物品元素无 locCode 时分配房间内字母编码（A、B、C…），并写入布局
  const autoLoc = useCallback((el: ItemElement): string => {
    const used = new Set(hist.layout.items.filter(i => i.locCode).map(i => i.locCode!.toUpperCase()));
    let letter = "A";
    let code = `${row.roomCode}-${letter}`;
    while (used.has(code.toUpperCase())) {
      letter = String.fromCharCode(letter.charCodeAt(0) + 1);
      code = `${row.roomCode}-${letter}`;
    }
    commit(patchElem({ ...el, locCode: code }));
    return code;
  }, [hist.layout, row.roomCode, commit]);

  // ── 保存：LayoutJson 全量序列化；计数同步为货架元素的值（无货架则 0 = 平面图模式）──
  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const shelves = layout.items.filter(i => i.type === "shelf");
      await api.put(`/api/storage/layouts/${row.id}`, {
        roomCode: row.roomCode,
        roomName,
        floor: row.floor,
        cabinetCount: shelves.length,
        shelfCount: shelves[0]?.shelfCount ?? 0,
        positionCount: shelves[0]?.positionCount ?? 0,
        description: row.description ?? "",
        layoutJson: layoutToJson(layout),
      });
      setMsg("已保存");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  };

  const dblEdit = (id: string) => { setSelected(id); setEditId(id); };
  const editEl = editId ? findElem(editId) : null;

  return (
    <div className="space-y-3">
      <PlannerToolbar
        roomCode={row.roomCode} roomName={roomName} onRoomName={setRoomName}
        width={layout.width} height={layout.height}
        onSize={(dim, v) => commit({ ...hist.layout, [dim]: v })}
        showLines={showLines} onToggleLines={() => setShowLines(v => !v)}
        canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} onUndo={undo} onRedo={redo}
        canDelete={selected !== null} onDelete={deleteSelected} onClear={clearAll}
        msg={msg} saving={saving} onSave={handleSave} onBack={onBack}
      />
      <div ref={workRef} className="relative flex gap-3 h-[calc(100vh-230px)] min-h-[460px]">
        <ElementPanel onAdd={addElement} />
        <PlannerCanvas layout={layout} items={items} selected={selected}
          onSelect={setSelected} onDblEdit={dblEdit}
          onDragEnd={onDragEnd} onTransformEnd={onTransformEnd}
          onMountMaterial={mountMaterial} onAutoLoc={autoLoc} onCellCenters={setCellCenters}
          onCellHover={code => setHoverKey(code)} />
        <MaterialsPanel roomCode={row.roomCode} items={items} elements={layout.items} selectedId={selected}
          onSelect={setSelected} onItemRects={setItemAnchors}
          onHoverItem={id => setHoverKey(id === null ? null : String(id))} onUnmount={unmountMaterial} />
        {showLines && <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />}
      </div>

      {editEl && (
        <PropertyDialog key={editEl.id} element={editEl} roomCode={row.roomCode}
          onSave={onPropertySave}
          onDelete={(id) => { commit(removeElem(hist.layout, id)); setEditId(null); setSelected(null); }}
          onClose={() => setEditId(null)} />
      )}
    </div>
  );
}

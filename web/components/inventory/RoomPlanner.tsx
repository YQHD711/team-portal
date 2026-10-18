"use client";
/** 房间平面图编辑器：工具栏/元素面板/画布/物料面板，管理历史与保存；物料支持拖拽与点选挂载、格位详情。
 * ⚠️ 真机事实（e2e 必踩）：**调色板只在「编辑平面图」模式下渲染**（非编辑模式页面上只有
 * `楼层概览/编辑平面图/连线关/物料清单`）→ e2e 必须先点「编辑平面图」。
 * ⚠️ 位移**只能**走 `applyMoved`（带子元素一起走）；删除**只能**走 `deleteById`（不静默丢子元素）。 */
import { useCallback, useReducer, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ElementKind, ItemElement, MaterialItem, PosElement, RoomLayout } from "./layoutTypes";
import { colsOf, rowsOf } from "./layoutTypes";
import { createElement, defaultLayout, layoutToJson, parseLayout, withElement } from "./layoutCodec";
import { ElementDetail } from "./ElementDetail";
import { ElementPanel } from "./ElementPanel";
import { PlannerCanvas } from "./PlannerCanvas";
import { PlannerToolbar } from "./PlannerToolbar";
import { MaterialsPanel } from "./MaterialsPanel";
import { MobileDrawer } from "./MobileDrawer";
import { MountStatusBar } from "./MountStatusBar";
import { ConnectionLines } from "./ConnectionLines";
import { useMountingState } from "./useMountingState";
import { PropertyDialog } from "./PropertyPanel";
import { usePlannerShortcuts } from "./usePlannerShortcuts";
import { usePlannerClipboard } from "./usePlannerClipboard";
import { CodeGenButton } from "./CodeGenButton";
import { deleteConfirmText, deleteElementSafe, deleteWithChildren } from "./layoutNesting";
import { useNestActions } from "./useNestActions";
import { ExportLocationLabelsButton } from "./ExportLocationLabelsButton";
import { historyReducer } from "./usePlannerHistory";
import type { RoomLayoutRow } from "./layoutRow";
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
  const [detail, setDetail] = useState<{ el: ItemElement; cell: string | null } | null>(null);
  const [pending, setPending] = useState<{ id: number; name: string } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);
  const { items, loadError, applyLocation, setItemAnchors, setCellCenters, hoverKey, setHoverKey, lines } =
    useMountingState(row.roomCode, layout.items);
  const commit = useCallback((next: RoomLayout) => dispatch({ type: "commit", next }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const { move, nest, detach } = useNestActions(layout, selected, commit, setMsg);
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
  // 删除**唯一入口**（工具栏、Delete 键、属性面板删除按钮都走这里）：有子元素时不静默
  const deleteById = (id: string) => {
    const r = deleteElementSafe(hist.layout, id);
    if (r.kind === "blocked") {
      if (!confirm(deleteConfirmText(r.children))) { setMsg("已取消：请先把子元素移出容器"); return; }
      commit(deleteWithChildren(hist.layout, id));
    } else commit(r.layout);
    setSelected(null);
  };
  const deleteSelected = () => { if (selected) deleteById(selected); };
  const clearAll = () => {
    const nested = hist.layout.items.filter(i => i.parentId).length;          // 规则②：清空也要点名被连带删掉的子元素
    const total = hist.layout.items.length + hist.layout.walls.length + hist.layout.doors.length + hist.layout.windows.length;
    if (!confirm(`将删除 ${total} 个元素，其中含 ${nested} 个位于容器内的子元素。\\n\\n可一次撤销。继续？`)) return;
    commit({ ...hist.layout, walls: [], doors: [], windows: [], items: [] });
    setSelected(null);
  };
  // ⚠️ 位移**只能**走 applyMoved：它会带着子元素一起走（绕过它子元素会漂移）
  const onDragEnd = move;                       // 位移唯一入口（applyMoved）
  const onTransformEnd = move;
  const onPropertySave = (el: PosElement | ItemElement) => { commit(withElement(hist.layout, el)); setEditId(null); };
  const findElem = (id: string): PosElement | ItemElement | null => {
    const cur = hist.layout;
    return [...cur.walls, ...cur.doors, ...cur.windows, ...cur.items].find(e => e.id === id) ?? null;
  };
  const { copy, paste } = usePlannerClipboard(layout, selected ? [selected] : [], commit, setSelected, setMsg);
  usePlannerShortcuts(selected, undo, redo, deleteSelected, copy, paste);   // Ctrl+C/V/Z 共用焦点守卫
  // ── 物料挂载/卸下：PUT locationCode 后按响应刷新列表与画布热点 ──
  const mountMaterial = async (id: number, code: string) => {
    if (await applyLocation(id, code)) setPending(null);
    else setMsg(`挂载失败：${code}`);
  };
  const unmountMaterial = (id: number) => {
    applyLocation(id, "").then(ok => { if (!ok) setMsg("卸下失败，请重试"); });
  };
  const pickMaterial = (it: MaterialItem) => {
    setPending({ id: it.id, name: it.name });
    setMsg("");
    setDrawer(false);
  };
  // 元素无 locCode 时分配房间内字母编码（A、B、C…），并写入布局
  const autoLoc = useCallback((el: ItemElement): string => {
    const used = new Set(hist.layout.items.filter(i => i.locCode).map(i => i.locCode!.toUpperCase()));
    let letter = "A";
    let code = `${row.roomCode}-${letter}`;
    while (used.has(code.toUpperCase())) {
      letter = String.fromCharCode(letter.charCodeAt(0) + 1);
      code = `${row.roomCode}-${letter}`;
    }
    commit(withElement(hist.layout, { ...el, locCode: code }));
    return code;
  }, [hist.layout, row.roomCode, commit]);
  // ── 保存：LayoutJson 全量序列化；汇总计数取全部元素的格位上限（兼容后端旧字段）──
  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const maxRows = layout.items.reduce((m, i) => Math.max(m, rowsOf(i)), 0);
      const maxCols = layout.items.reduce((m, i) => Math.max(m, colsOf(i)), 0);
      await api.put(`/api/storage/layouts/${row.id}`, {
        roomCode: row.roomCode,
        roomName: roomName.trim() || row.roomName,
        floor: row.floor,
        cabinetCount: Math.min(99, layout.items.length),
        shelfCount: Math.min(9, maxRows),
        positionCount: Math.min(99, maxCols),
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
  const panelProps = {
    roomCode: row.roomCode, items, elements: layout.items, selectedId: selected,
    onSelect: setSelected, onItemRects: setItemAnchors,
    onHoverItem: (id: number | null) => setHoverKey(id === null ? null : String(id)),
    onUnmount: unmountMaterial, onPick: pickMaterial, pendingId: pending?.id ?? null,
    onDetail: (el: ItemElement) => setDetail({ el, cell: null }),
  };
  return (
    <div className="space-y-3">
      <CodeGenButton layout={layout} materials={items} roomCode={row.roomCode} onApply={commit} />
      <ExportLocationLabelsButton layout={layout} roomName={row.roomName} />
      <PlannerToolbar
        roomCode={row.roomCode} roomName={roomName} onRoomName={setRoomName}
        width={layout.width} height={layout.height}
        onSize={(dim, v) => commit({ ...hist.layout, [dim]: v })}
        showLines={showLines} onToggleLines={() => setShowLines(v => !v)}
        canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} onUndo={undo} onRedo={redo}
        canDelete={selected !== null} onDelete={deleteSelected} onClear={clearAll}
        msg={msg} saving={saving} onSave={handleSave} onBack={onBack}
      />
      <ElementPanel onAdd={addElement} variant="strip" />
      <MountStatusBar pending={pending} loadError={loadError} onCancel={() => setPending(null)} />
      <div ref={workRef} className="relative flex flex-col gap-3 lg:h-[calc(100dvh-260px)] lg:min-h-[460px] lg:flex-row">
        <ElementPanel onAdd={addElement} />
        <PlannerCanvas layout={layout} items={items} selected={selected}
          className="h-[52vh] min-h-[320px] lg:h-full"
          onSelect={setSelected} onDblEdit={dblEdit}
          onDragEnd={onDragEnd} onTransformEnd={onTransformEnd}
          onMountMaterial={mountMaterial} onAutoLoc={autoLoc} onCellCenters={setCellCenters}
          onCellHover={code => setHoverKey(code)} pendingMount={pending} />
        <MaterialsPanel {...panelProps} className="h-full w-64 shrink-0 max-lg:hidden" />
        <MobileDrawer open={drawer} onToggle={() => setDrawer(v => !v)} title={`物料挂载（${items.length}）`}>
          <MaterialsPanel {...panelProps} className="max-h-[45vh]" />
        </MobileDrawer>
        {showLines && <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />}
      </div>
      {editEl && (
        <PropertyDialog key={editEl.id} element={editEl} roomCode={row.roomCode} items={items} nest={{ layout, selectedHasParent: !!editEl.parentId, onNest: nest, onDetach: detach }}
          onSave={onPropertySave}
          onDelete={(id) => { deleteById(id); setEditId(null); }}
          onDetail={(el) => { setEditId(null); setDetail({ el, cell: null }); }}
          onClose={() => setEditId(null)} />
      )}
      {detail && (
        <ElementDetail element={detail.el} items={items} initialCell={detail.cell} onClose={() => setDetail(null)}  roomName={row.roomName} />
      )}
    </div>
  );
}

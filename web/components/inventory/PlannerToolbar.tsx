"use client";

/** 平面图编辑器顶部工具栏：房间信息、画布尺寸、连线开关、撤销重做、删除清空、保存 */
import { ChevronLeft, Eraser, Network, Redo2, Save, Trash2, Undo2 } from "lucide-react";

interface PlannerToolbarProps {
  roomCode: string;
  roomName: string;
  onRoomName: (v: string) => void;
  width: number;
  height: number;
  onSize: (dim: "width" | "height", v: number) => void;
  showLines: boolean;
  onToggleLines: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canDelete: boolean;
  onDelete: () => void;
  onClear: () => void;
  msg: string;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
}

const iconBtn = "rounded-lg p-1.5 text-muted hover:bg-surface-hover disabled:opacity-30";
const inputCls = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

export function PlannerToolbar(props: PlannerToolbarProps) {
  const { roomCode, roomName, onRoomName, width, height, onSize, showLines, onToggleLines, canUndo, canRedo, onUndo, onRedo,
    canDelete, onDelete, onClear, msg, saving, onSave, onBack } = props;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <button onClick={onBack}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-sky-600">
        <ChevronLeft className="h-4 w-4" />返回
      </button>
      <span className="font-mono text-xs text-faint">{roomCode}</span>
      <input value={roomName} onChange={e => onRoomName(e.target.value)}
        placeholder="房间名称" title="房间名称（房间号不可改）"
        className={`w-36 ${inputCls}`} />
      <span className="text-xs text-faint">画布</span>
      <input type="number" min={200} value={width}
        onChange={e => onSize("width", Number(e.target.value) || 900)} title="画布宽度"
        className={`w-16 ${inputCls}`} />
      <span className="text-xs text-faint">×</span>
      <input type="number" min={200} value={height}
        onChange={e => onSize("height", Number(e.target.value) || 600)} title="画布高度"
        className={`w-16 ${inputCls}`} />
      <button onClick={onToggleLines} title="显示/隐藏物料连线"
        className={`rounded-lg p-1.5 ${showLines ? "bg-sky-100 dark:bg-sky-950 text-sky-600" : "text-muted hover:bg-surface-hover"}`}>
        <Network className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-surface-hover" />
      <button onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)" className={iconBtn}><Undo2 className="h-4 w-4" /></button>
      <button onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Y)" className={iconBtn}><Redo2 className="h-4 w-4" /></button>
      <button onClick={onDelete} disabled={!canDelete} title="删除选中 (Delete)"
        className="rounded-lg p-1.5 text-muted hover:bg-red-50 dark:hover:bg-red-950 hover:text-danger disabled:opacity-30">
        <Trash2 className="h-4 w-4" />
      </button>
      <button onClick={onClear} title="清空画布" className={iconBtn}><Eraser className="h-4 w-4" /></button>
      <div className="flex-1" />
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button onClick={onSave} disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60 shadow-sm">
        <Save className="h-4 w-4" />{saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}

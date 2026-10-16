"use client";

/** 移入/移出容器（**显式动作 + 目标列表**，不做拖拽落点）：拒绝时把原因显示出来，不静默失败。 */
import { useState } from "react";
import type { ItemElement, RoomLayout } from "./layoutTypes";
import { nestableParents } from "./useNestActions";

interface Props {
  layout: RoomLayout;
  selected: string | null;
  selectedHasParent: boolean;
  onNest: (parentId: string) => void;
  onDetach: () => void;
}

export function NestActionsButton({ layout, selected, selectedHasParent, onNest, onDetach }: Props) {
  const [target, setTarget] = useState("");
  const parents = nestableParents(layout, selected);

  if (!selected) return null;

  return (
    <div data-testid="nest-actions" className="flex flex-wrap items-center gap-2">
      {parents.length > 0 ? (
        <>
          <label className="text-[11px] text-muted" htmlFor="nest-target">移入容器：</label>
          <select id="nest-target" data-testid="nest-target" value={target}
            onChange={e => setTarget(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs">
            <option value="">选择目标…</option>
            {parents.map((p: ItemElement) => (
              <option key={p.id} value={p.id}>{p.name}{p.locCode ? `（${p.locCode}）` : ""}</option>
            ))}
          </select>
          <button type="button" data-testid="nest-apply" disabled={!target}
            onClick={() => { onNest(target); setTarget(""); }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover disabled:opacity-50">
            移入
          </button>
        </>
      ) : (
        <span data-testid="nest-none" className="text-[11px] text-faint">
          {selectedHasParent ? "该元素已在容器内（仅支持 1 层）" : "没有可作为容器的目标"}
        </span>
      )}
      {selectedHasParent && (
        <button type="button" data-testid="nest-detach" onClick={onDetach}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover">
          移出容器
        </button>
      )}
    </div>
  );
}

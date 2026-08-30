"use client";

/** 左侧元素面板：点击即可添加到画布 */
import type { ElementKind } from "./layoutTypes";
import { ELEMENT_DEFS } from "./layoutTypes";

interface ElementPanelProps {
  onAdd: (kind: ElementKind) => void;
}

const KINDS: ElementKind[] = ["shelf", "workbench", "cabinet", "device", "wall", "door", "window"];

export function ElementPanel({ onAdd }: ElementPanelProps) {
  return (
    <div className="w-40 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto">
      <h3 className="text-xs font-semibold text-muted mb-2">元素</h3>
      <div className="space-y-1.5">
        {KINDS.map(kind => {
          const def = ELEMENT_DEFS[kind];
          const Icon = def.icon;
          return (
            <button key={kind} onClick={() => onAdd(kind)} title={`添加${def.label}`}
              className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors">
              <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: `${def.color}22`, color: def.color }}>
                <Icon className="h-4 w-4" />
              </span>
              {def.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        点击添加元素到画布中央；货架支持 层×位 格子与物料挂载。
      </p>
    </div>
  );
}

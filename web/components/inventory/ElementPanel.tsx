"use client";

/** 元素面板：点击添加元素到画布；桌面为左侧竖栏（带说明），移动端为可横向滚动的紧凑条 */
import type { ElementKind, ItemType } from "./layoutTypes";
import { ELEMENT_DEFS } from "./layoutTypes";

interface ElementPanelProps {
  onAdd: (kind: ElementKind) => void;
  /** side = 桌面侧栏；strip = 移动端横条 */
  variant?: "side" | "strip";
}

const KINDS: ElementKind[] = ["shelf", "workbench", "cabinet", "device", "wall", "door", "window"];
/** 默认划分格位的类型（用于侧栏说明） */
const CELL_KINDS: ItemType[] = ["shelf", "cabinet", "workbench"];

function Icon({ kind }: { kind: ElementKind }) {
  const def = ELEMENT_DEFS[kind];
  const Cmp = def.icon;
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      style={{ backgroundColor: `${def.color}22`, color: def.color }}>
      <Cmp className="h-4 w-4" />
    </span>
  );
}

export function ElementPanel({ onAdd, variant = "side" }: ElementPanelProps) {
  if (variant === "strip") {
    return (
      <div className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-surface p-2 lg:hidden">
        {KINDS.map(kind => {
          const def = ELEMENT_DEFS[kind];
          return (
            <button key={kind} onClick={() => onAdd(kind)} title={`添加${def.label}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs hover:border-sky-400">
              <Icon kind={kind} />{def.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="hidden w-40 shrink-0 overflow-y-auto rounded-xl border border-border bg-surface p-3 lg:block">
      <h3 className="mb-2 text-xs font-semibold text-muted">元素</h3>
      <div className="space-y-1.5">
        {KINDS.map(kind => {
          const def = ELEMENT_DEFS[kind];
          return (
            <button key={kind} onClick={() => onAdd(kind)} title={`添加${def.label}（${def.hint}）`}
              className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40">
              <Icon kind={kind} />
              <span className="min-w-0 flex-1 truncate text-left">{def.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        尺寸单位统一为 cm。货架/柜子/工作台可设「行 × 列」格位，双击元素可改属性与格位划分。
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        默认格位：{CELL_KINDS.map(t => {
          const d = ELEMENT_DEFS[t];
          return `${d.label} ${d.rows}${d.rowLabel} × ${d.cols}${d.colLabel}`;
        }).join(" · ")}
      </p>
    </div>
  );
}

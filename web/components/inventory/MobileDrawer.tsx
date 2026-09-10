"use client";

/** 移动端底部抽屉：≤lg 时承载侧栏（物料/元素），可展开收起 */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function MobileDrawer({ open, onToggle, title, children }: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="lg:hidden">
      <button type="button" onClick={onToggle}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium">
        <span className="truncate">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

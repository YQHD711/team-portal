"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { TourCenter } from "./TourCenter";

/** 顶栏「?」：随时打开引导中心（含当前功能的重看入口） */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="使用引导" title="使用引导"
        className="rounded-xl p-2 text-muted hover:bg-surface-hover hover:text-foreground transition-colors">
        <HelpCircle className="h-5 w-5" />
      </button>
      <TourCenter open={open} onClose={() => setOpen(false)} />
    </>
  );
}

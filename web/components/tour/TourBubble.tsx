"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

interface Props {
  title: string;
  body: string;
  index: number;
  total: number;
  action?: { label: string; href: string };
  style: CSSProperties;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** 引导气泡：标题/正文/步骤计数/上一步/下一步/跳过。桌面按目标位置浮动，移动端贴底。 */
export function TourBubble({ title, body, index, total, action, style, onPrev, onNext, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 打开/切步把焦点放进气泡，键盘用户不必 Tab 穿越整页
  useEffect(() => {
    ref.current?.focus();
  }, [index]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      style={style}
      className="fixed z-[61] rounded-2xl border border-border bg-surface p-4 shadow-2xl outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono text-muted">{index + 1} / {total}</div>
          <h3 className="mt-0.5 text-sm font-semibold">{title}</h3>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="关闭引导">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">{body}</p>

      {action && (
        <a href={action.href} onClick={onClose}
          className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
          {action.label}
        </a>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button onClick={onClose} className="text-[11px] text-faint hover:text-foreground">跳过不再提示</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onPrev} disabled={index === 0}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover disabled:opacity-40">
            <ArrowLeft className="h-3 w-3" />上一步
          </button>
          <button onClick={onNext}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">
            {index === total - 1 ? "完成" : "下一步"}
            {index < total - 1 && <ArrowRight className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}

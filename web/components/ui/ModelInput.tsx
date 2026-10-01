"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/** 常用模型名，仅作输入建议 —— 输入框本身接受任意名称（对接自建/兼容端点时用得上）。 */
export const MODEL_SUGGESTIONS = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-reasoner",
] as const;

/** 候选列表最大高度与单项高度（px）：只用于估算向上/向下弹出 */
const LIST_MAX_H = 240;
const ITEM_H = 32;

interface ListPos { top: number; bottom: number; left: number; width: number; up: boolean }

/**
 * 由输入框位置算出弹层坐标（fixed 定位，跟着输入框走）。
 * 空间不够就向上弹，避免在页面底部被切掉。
 */
function rectToPos(r: DOMRect, count: number): ListPos {
  const room = Math.min(count * ITEM_H + 8, LIST_MAX_H);
  return {
    top: r.bottom + 4,
    bottom: window.innerHeight - r.top + 4,
    left: r.left,
    width: r.width,
    up: r.bottom + room > window.innerHeight && r.top > room,
  };
}

interface ModelInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  label?: string;
  /** 外层容器附加类（宽度等）；输入框始终撑满容器 */
  className?: string;
}

/**
 * 模型名称输入框：自由填写 + 常用名下拉建议。
 *
 * 为什么不再用原生 `<datalist>`：它的弹出面板是**浏览器自己的 UI**，点箭头有没有反应由浏览器决定，
 * 我们既没法用 DOM 断言、也不保证桌面/手机一致（用户报的「按了没反应」正是这条路径）。实测在真
 * Edge/Chromium 里连「一个最小可用的 datalist」都点不开弹层，无法定位也无法验证。
 * 换成自己画的受控下拉后，「点箭头展开、选中写回」变成我们能测、能保证的行为；仍然可以手输任意
 * 模型名 —— 不用 `<select>` 是因为模型名由上游决定，写死选项会把自建/新模型挡在外面。
 */
export function ModelInput({ value, onChange, suggestions = MODEL_SUGGESTIONS, placeholder = "例如 deepseek-v4-pro", label, className = "" }: ModelInputProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<ListPos>({ top: 0, bottom: 0, left: 0, width: 0, up: false });
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hasSuggestions = suggestions.length > 0;

  const close = () => { setOpen(false); setActive(-1); };

  /** 弹层用 fixed 定位：设置页那一行在 overflow-hidden 的卡片里，absolute 会被裁掉 */
  const toggle = () => {
    if (open) { close(); return; }
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setPos(rectToPos(r, suggestions.length));
    setOpen(true);
    setActive(-1);
  };

  useEffect(() => {
    if (!open) return;
    // 滚动/缩放时**重算坐标**而不是关闭：点箭头本身就可能让页面滚动一下
    // （浏览器把聚焦元素滚进视野），上一版直接关掉，表现就是「按了没反应」。
    const reposition = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setPos(rectToPos(r, suggestions.length));
    };
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setActive(-1); }
    };
    reposition();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, suggestions.length]);

  const pick = (m: string) => { onChange(m); close(); inputRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
      if (e.key === "Enter" && open && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
      return;
    }
    e.preventDefault();
    if (!open) { toggle(); setActive(e.key === "ArrowDown" ? 0 : suggestions.length - 1); return; }
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive(i => (i + step + suggestions.length) % suggestions.length);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label ?? "模型名称"}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-9 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      {hasSuggestions && (
        <button
          type="button"
          data-testid="model-input-toggle"
          onClick={toggle}
          aria-label={open ? "收起常用模型" : "展开常用模型"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:bg-surface-hover"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && hasSuggestions && (
        <div
          id={listId}
          role="listbox"
          data-testid="model-input-options"
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            maxHeight: LIST_MAX_H,
            ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }),
          }}
          className="z-50 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
        >
          {suggestions.map((m, i) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === value}
              data-testid={`model-option-${m}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(m)}
              className={`block w-full px-3 py-1.5 text-left font-mono text-sm hover:bg-surface-hover ${i === active ? "bg-surface-hover" : ""} ${m === value ? "text-primary" : "text-muted"}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

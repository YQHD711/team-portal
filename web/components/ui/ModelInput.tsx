"use client";

import { useId } from "react";

/** 常用模型名，仅作输入建议 —— 输入框本身接受任意名称（对接自建/兼容端点时用得上）。 */
export const MODEL_SUGGESTIONS = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-reasoner",
] as const;

/**
 * 模型名称输入框：自由填写 + 常用名建议（datalist）。
 * 不用 <select> 是因为模型名由上游决定，写死选项会把自建/新模型挡在外面。
 */
export function ModelInput({
  value,
  onChange,
  suggestions = MODEL_SUGGESTIONS,
  placeholder = "例如 deepseek-v4-pro",
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  // 同一页面可能有多个输入框，datalist id 必须唯一（useId 在 SSR/严格模式下都稳定）
  const listId = useId();

  return (
    <>
      <input
        type="text"
        aria-label={label ?? "模型名称"}
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 ${className}`}
      />
      <datalist id={listId}>
        {suggestions.map(m => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

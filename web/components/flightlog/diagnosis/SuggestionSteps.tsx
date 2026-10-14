"use client";

import type { Suggestion } from "@/lib/flightlog/types/report";

/** 建议步骤：编号顺序、验证指标、参数改动（from → to） */
export function SuggestionSteps({ suggestions }: { suggestions: readonly Suggestion[] }) {
  if (suggestions.length === 0) return null;

  const ordered = [...suggestions].sort((a, b) => a.order - b.order);

  return (
    <ol data-testid="suggestion-steps" className="space-y-2">
      {ordered.map(s => (
        <li key={s.order} className="flex gap-2 text-xs">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {s.order}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="leading-relaxed">{s.text}</p>

            {s.param && (
              <p data-testid="suggestion-param" className="rounded bg-surface-subtle px-2 py-1 font-mono text-[11px]">
                {s.param.name}: <span className="text-muted">{s.param.from === null ? "未知" : s.param.from}</span>
                {" → "}
                <span className="font-semibold text-foreground">{s.param.to}</span>
                {s.param.reason && <span className="ml-2 font-sans text-faint">（{s.param.reason}）</span>}
              </p>
            )}

            {s.verify && (
              <p data-testid="suggestion-verify" className="text-[11px] text-muted">
                验证：{s.verify}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

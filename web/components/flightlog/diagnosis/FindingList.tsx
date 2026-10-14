"use client";

import { useState } from "react";
import type { DiagnosisReport, Severity } from "@/lib/flightlog/types/report";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { FindingCard } from "./FindingCard";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "./format";

type Filter = "all" | Severity;

/** 结论列表：汇总 + 严重等级筛选 + 每条结论卡片 */
export function FindingList({ report, doc }: { report: DiagnosisReport; doc?: LogDocument }) {
  const [filter, setFilter] = useState<Filter>("all");
  const s = report.summary;

  const chips: { id: Filter; label: string; count: number; active: string }[] = [
    { id: "all", label: "全部", count: report.findings.length, active: "bg-surface-hover text-foreground" },
    { id: "critical", label: SEVERITY_LABEL.critical, count: s.critical, active: "bg-danger/15 text-danger" },
    { id: "warning", label: SEVERITY_LABEL.warning, count: s.warning, active: "bg-warning/15 text-warning" },
    { id: "unknown", label: SEVERITY_LABEL.unknown, count: s.unknown, active: "bg-surface-hover text-foreground" },
    { id: "ok", label: "通过", count: s.passed, active: "bg-success/15 text-success" },
  ];

  // 已按 critical → warning → unknown → ok 排序（契约保证），这里只做筛选
  const shown = report.findings.filter(f => filter === "all" || f.severity === filter);

  return (
    <div className="space-y-3">
      <div data-testid="finding-filters" className="flex flex-wrap items-center gap-1">
        {chips.map(c => (
          <button key={c.id} type="button" onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            data-testid={`filter-${c.id}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === c.id ? c.active : "text-muted hover:bg-surface-hover"}`}>
            {c.label} {c.count}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-faint">
          共 {report.findings.length} 条结论（按严重等级排序）
        </span>
      </div>

      <ul data-testid="finding-list" className="space-y-3">
        {shown.map(f => <FindingCard key={f.ruleId} finding={f} doc={doc} />)}
      </ul>

      {shown.length === 0 && (
        <p data-testid="finding-empty" className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-faint">
          没有{SEVERITY_ORDER.includes(filter as Severity) ? SEVERITY_LABEL[filter as Severity] : ""}等级的结论。
        </p>
      )}
    </div>
  );
}

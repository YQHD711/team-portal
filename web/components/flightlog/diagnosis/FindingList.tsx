"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DiagnosisReport, Finding, Severity } from "@/lib/flightlog/types/report";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { FindingCard } from "./FindingCard";
import { SEVERITY_BADGE_CLASS, SEVERITY_LABEL, SEVERITY_ORDER, statusLabel } from "./format";

type Filter = "all" | Severity;

/** 折叠组里用的短名："速度环 / 位置环跟踪（空速环）" → "空速环" */
function shortName(f: Finding): string {
  const open = f.title.indexOf("（");
  return open < 0 ? f.title : f.title.slice(open + 1, -1);
}

/**
 * 结论列表：汇总 + 严重等级筛选 + 每条结论卡片。
 *
 * ⚠️ **结构性不适用**（机型根本没有这个通道，如多旋翼的"空速环"、固定翼的 TECS）
 * 折叠成一行汇总，不单独占卡片（用户：「非此机型的数据不要展示了」）。
 * 但**折叠 ≠ 静默**：条数与名称在汇总行里始终可见，展开后每条的原因（note）都在——
 * "缺数据/不适用绝不静默"是既有底线，折叠不允许把它变成隐藏。
 */
export function FindingList({ report, doc }: { report: DiagnosisReport; doc?: LogDocument }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [naOpen, setNaOpen] = useState(false);
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
  const structural = shown.filter(f => f.status === "not_applicable");
  const cards = shown.filter(f => f.status !== "not_applicable");

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
        {cards.map((f, i) => <FindingCard key={`${f.ruleId}-${i}`} finding={f} doc={doc} />)}
      </ul>

      {/* 结构性不适用：折叠成一行，但条数与名称可见、展开后原因齐全 */}
      {structural.length > 0 && (
        <div data-testid="finding-na-group" className="rounded-xl border border-dashed border-border">
          <button type="button" data-testid="finding-na-summary" aria-expanded={naOpen}
            onClick={() => setNaOpen(o => !o)}
            className="flex w-full items-center gap-1 px-3 py-2 text-left text-[11px] text-muted hover:bg-surface-hover">
            {naOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            本机型不适用 {structural.length} 项：{structural.map(shortName).join("、")}
            <span className="ml-auto text-faint">展开可看原因</span>
          </button>
          {naOpen && (
            <ul data-testid="finding-na-list" className="space-y-1 border-t border-border px-3 py-2">
              {structural.map((f, i) => (
                <li key={`${f.ruleId}-na-${i}`} data-testid="finding-card" data-rule-id={f.ruleId}
                  data-status={f.status} data-severity={f.severity} className="text-[11px] leading-relaxed">
                  <span data-testid="finding-severity" className={SEVERITY_BADGE_CLASS[f.severity]}>
                    {statusLabel(f.status)}
                  </span>
                  <span className="ml-1 font-medium">{f.title}</span>
                  <span data-testid="finding-note" className="text-muted"> —— {f.note ?? "规则未给出原因说明"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shown.length === 0 && (
        <p data-testid="finding-empty" className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-faint">
          没有{SEVERITY_ORDER.includes(filter as Severity) ? SEVERITY_LABEL[filter as Severity] : ""}等级的结论。
        </p>
      )}
    </div>
  );
}

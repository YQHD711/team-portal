"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Finding } from "@/lib/flightlog/types/report";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { EvidencePanel } from "./EvidencePanel";
import { SuggestionSteps } from "./SuggestionSteps";
import {
  AXIS_LABEL, SEVERITY_BADGE_CLASS, SEVERITY_CLASS, SEVERITY_LABEL,
  isUnknownSide, statusBadgeClass, statusLabel, windowLabel,
} from "./format";

/**
 * 一条结论：五要素（时间定位 / 现象 / 影响 / 建议 / 等级）+ 可展开证据。
 *
 * ⚠️ 负向对照：只有 `status === "passed"` 才显示「通过」。
 * not_applicable / checked_but_not_supported / missing_required / insufficient_data
 * 属于 unknown 一侧 → 显示「无法判断/不适用」**并把 note 原因摆出来**，绝不允许看起来像通过。
 *
 * ⚠️ 两处**默认可见、不进折叠**（线上复验抓到的缺口：fired 结论上"起点值声明/降落段排除依据"
 * 与建议全被折叠挡住，恰恰是最需要它们的时候）：
 *  - `note`：unknown 一侧用醒目「原因」样式；fired/passed 用**弱化**的依据样式（不抢 impact）；
 *  - 建议块：带 from → to 数字的参数建议必须直接看到，只有**证据**才需要用户主动展开。
 */
export function FindingCard({ finding, doc }: { finding: Finding; doc?: LogDocument }) {
  const [open, setOpen] = useState(finding.severity === "critical");
  const unknownSide = isUnknownSide(finding.status);
  const hasEvidence = finding.evidence.length > 0 || finding.charts.length > 0
    || finding.docLinks.length > 0 || Object.keys(finding.metrics).length > 0;
  const note = finding.note?.trim() ? finding.note : null;

  return (
    <li data-testid="finding-card" data-rule-id={finding.ruleId} data-status={finding.status}
      data-severity={finding.severity}
      className={`rounded-xl border-l-4 border border-border p-3 ${SEVERITY_CLASS[finding.severity]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="finding-severity" className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE_CLASS[finding.severity]}`}>
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span data-testid="finding-status" className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(finding.status)}`}>
          {statusLabel(finding.status)}
        </span>
        <span className="text-sm font-semibold">{finding.title}</span>
        {finding.axis && <span className="text-[11px] text-muted">{AXIS_LABEL[finding.axis]}轴</span>}
        <span className="ml-auto text-[11px] text-faint" title="时间定位">{windowLabel(finding.window)}</span>
      </div>

      {/* unknown 一侧：原因必须醒目显示（不允许静默跳过） */}
      {unknownSide && (
        <p data-testid="finding-note" className="mt-2 rounded-lg border-l-4 border-warning bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          原因：{note ?? "规则未给出原因说明"}
        </p>
      )}

      {/* fired / passed：note 是"依据 / 免责声明"（起点值声明、降落段排除依据…），
          弱化样式但**默认可见**，不与被折叠的证据混在一起 */}
      {!unknownSide && note && (
        <p data-testid="finding-note" className="mt-1.5 text-[11px] leading-relaxed text-faint">
          <span className="font-medium text-muted">依据 / 说明：</span>{note}
        </p>
      )}

      <p data-testid="finding-phenomenon" className="mt-2 text-xs leading-relaxed">{finding.phenomenon}</p>
      <p data-testid="finding-impact" className="mt-1 text-xs leading-relaxed text-muted">影响：{finding.impact}</p>

      {/* 建议默认可见（参数 from → to 是用户最想要的数字） */}
      {finding.suggestions.length > 0 && (
        <div data-testid="finding-suggestions" className="mt-2 border-t border-border pt-2">
          <h5 className="mb-1.5 text-[11px] font-medium text-muted">建议（按顺序执行）</h5>
          <SuggestionSteps suggestions={finding.suggestions} />
        </div>
      )}

      {hasEvidence && (
        <>
          <button type="button" data-testid="finding-toggle" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline dark:text-sky-400">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {open ? "收起证据" : "展开证据"}
          </button>
          {open && <EvidencePanel finding={finding} doc={doc} />}
        </>
      )}
    </li>
  );
}

"use client";

import type { Finding } from "@/lib/flightlog/types/report";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { UplotChart } from "./UplotChart";
import { pickSeries } from "./chartData";
import { metricRows } from "./format";

/** 证据面板：metrics + 计算过程（evidence）+ 依据链接（docLinks）+ 图表 */
export function EvidencePanel({ finding, doc }: { finding: Finding; doc?: LogDocument }) {
  const rows = metricRows(finding.metrics);

  return (
    <div data-testid="evidence-panel" className="space-y-3 border-t border-border px-3 py-3">
      {rows.length > 0 && (
        <div>
          <h5 className="mb-1 text-[11px] font-medium text-muted">关键量</h5>
          <dl data-testid="evidence-metrics" className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {rows.map(r => (
              <div key={r.key} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="truncate text-faint" title={r.key}>{r.key}</dt>
                <dd className="font-mono">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {finding.evidence.length > 0 && (
        <div>
          <h5 className="mb-1 text-[11px] font-medium text-muted">判定过程</h5>
          <ol data-testid="evidence-steps" className="space-y-1">
            {finding.evidence.map((step, i) => (
              <li key={`${step.label}-${i}`} className="text-xs leading-relaxed">
                <span className="font-medium">{step.label}</span>
                <span className="text-muted">：{step.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {finding.charts.length > 0 && (
        <div className="space-y-2">
          {finding.charts.map(chart => {
            // 时序图的信号数据来自 LogDocument（契约未在 DiagnosisResult 里回传时 doc 为 undefined）
            const series = doc ? chart.signals.map(ref => pickSeries(doc, ref)).filter((s): s is NonNullable<typeof s> => s !== null) : [];
            return <UplotChart key={chart.id} chart={chart} series={series} events={doc?.events ?? []} />;
          })}
        </div>
      )}

      {finding.docLinks.length > 0 && (
        <div>
          <h5 className="mb-1 text-[11px] font-medium text-muted">依据</h5>
          <ul data-testid="evidence-doc-links" className="space-y-0.5">
            {finding.docLinks.map(link => (
              <li key={link}>
                <a href={link} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline dark:text-sky-400">
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

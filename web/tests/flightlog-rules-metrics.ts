/**
 * 规则语料标定的**指标汇总**：把每条结论的指标按"机型 × 通道"聚合成分位数。
 *
 * 为什么单独一个文件：这是"阈值该定多少"的输入，需要能被报告与其他规则复用，
 * 且与"怎么跑规则"（flightlog-rules-corpus-fixture.ts）分开，各自保持短小。
 */

import type { FileRulesReport, MetricRow } from "./flightlog-rules-corpus-fixture";

function quantile(values: readonly number[], p: number): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return Number.NaN;
  const pos = p * (clean.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(clean.length - 1, lo + 1);
  return clean[lo] + (clean[hi] - clean[lo]) * (pos - lo);
}

export interface ChannelDistribution {
  vehicle: string;
  subject: string;
  /** 有指标可算的行数（含被门槛拒判的行：标定要看的是"全体实测分布"） */
  n: number;
  /** 该通道出现过的结论总数 */
  nAll: number;
  errP50: number;
  errP90: number;
  errP95: number;
  errMax: number;
  exciteP50: number;
  targetP50: number;
  ratioP50: number;
  ratioP90: number;
  ratioMax: number;
  statuses: Record<string, number>;
}

/** 按 机型 × 通道 汇总实测分布（阈值标定的输入；未判定的行不计入分位数） */
export function distributions(reports: readonly FileRulesReport[]): ChannelDistribution[] {
  const buckets = new Map<string, MetricRow[]>();
  for (const report of reports) {
    for (const row of report.rows) {
      const key = `${row.vehicle}|${row.ruleId}|${row.subject}`;
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
  }
  const out: ChannelDistribution[] = [];
  for (const [key, rows] of buckets) {
    const [vehicle, , subject] = key.split("|");
    const judged = rows.filter((r) => Number.isFinite(r.errRms));
    const errors = judged.map((r) => r.errRms);
    const ratios = judged.map((r) => r.errRatio);
    const statuses: Record<string, number> = {};
    for (const row of rows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    out.push({
      vehicle,
      subject,
      n: judged.length,
      nAll: rows.length,
      errP50: quantile(errors, 0.5),
      errP90: quantile(errors, 0.9),
      errP95: quantile(errors, 0.95),
      errMax: errors.length > 0 ? Math.max(...errors) : Number.NaN,
      exciteP50: quantile(judged.map((r) => r.excitement), 0.5),
      targetP50: quantile(judged.map((r) => r.targetRms), 0.5),
      ratioP50: quantile(ratios, 0.5),
      ratioP90: quantile(ratios, 0.9),
      ratioMax: ratios.length > 0 ? Math.max(...ratios) : Number.NaN,
      statuses,
    });
  }
  return out.sort((a, b) => `${a.vehicle}${a.subject}`.localeCompare(`${b.vehicle}${b.subject}`));
}

/** 数字 → 表格单元格（非有限值显示 "-"，避免 NaN 干扰阅读） */
function cell(value: number, digits: number): string {
  return (Number.isFinite(value) ? value.toFixed(digits) : "-").padStart(digits + 5);
}

export function formatDistribution(rows: readonly ChannelDistribution[]): string {
  const lines = [
    "vehicle".padEnd(11) + "channel".padEnd(20) + "rows".padStart(10)
      + "errP50".padStart(9) + "errP90".padStart(9) + "errP95".padStart(9) + "errMax".padStart(9)
      + "exciteP50".padStart(11) + "targP50".padStart(9) + "ratP50".padStart(8) + "ratP90".padStart(8)
      + "  status",
  ];
  for (const r of rows) {
    lines.push(
      r.vehicle.padEnd(11) + r.subject.padEnd(20) + `${r.n}/${r.nAll}`.padStart(10)
      + cell(r.errP50, 3) + cell(r.errP90, 3) + cell(r.errP95, 3) + cell(r.errMax, 3)
      + cell(r.exciteP50, 3) + cell(r.targetP50, 2) + cell(r.ratioP50, 3) + cell(r.ratioP90, 3)
      + "  " + Object.entries(r.statuses).map(([k, v]) => `${k}=${v}`).join(","),
    );
  }
  return lines.join("\n");
}

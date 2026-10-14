/**
 * Finding 构造器：把"五要素齐全 + 缺省值显式化"固化下来，
 * 避免每条规则各写一遍默认值（也避免漏填 impact/建议）。
 */

import type { Finding, Severity, CheckStatus } from "../types/report";
import type { ChartRequest, EvidenceStep, ParamChange, Suggestion } from "../types/report";
import type { LogMeta, TimeWindow } from "../types/log";

export interface FindingInit {
  ruleId: string;
  title: string;
  severity: Severity;
  status: CheckStatus;
  phenomenon: string;
  impact: string;
  window?: TimeWindow | null;
  axis?: "roll" | "pitch" | "yaw" | null;
  evidence?: readonly EvidenceStep[];
  metrics?: Readonly<Record<string, number>>;
  suggestions?: readonly Suggestion[];
  docLinks?: readonly string[];
  charts?: readonly ChartRequest[];
  note?: string | null;
}

export function makeFinding(init: FindingInit): Finding {
  return {
    ruleId: init.ruleId,
    title: init.title,
    severity: init.severity,
    status: init.status,
    window: init.window ?? null,
    axis: init.axis ?? null,
    phenomenon: init.phenomenon,
    impact: init.impact,
    evidence: init.evidence ?? [],
    metrics: init.metrics ?? {},
    suggestions: init.suggestions ?? [],
    docLinks: init.docLinks ?? [],
    charts: init.charts ?? [],
    note: init.note ?? null,
  };
}

/** 数据不足 / 不适用 / 缺消息时的统一构造：severity 必须是 unknown。 */
export function unknownFinding(args: {
  ruleId: string;
  title: string;
  status: Extract<
    CheckStatus,
    "not_applicable" | "checked_but_not_supported" | "missing_required" | "insufficient_data"
  >;
  note: string;
}): Finding {
  return makeFinding({
    ruleId: args.ruleId,
    title: args.title,
    severity: "unknown",
    status: args.status,
    phenomenon: "未能完成检查",
    impact: "无法判断该方面是否存在问题，不代表通过",
    note: args.note,
  });
}

export function step(label: string, detail: string): EvidenceStep {
  return { label, detail };
}

export function suggestion(
  order: number,
  text: string,
  options: { param?: ParamChange | null; verify?: string | null } = {},
): Suggestion {
  return {
    order,
    text,
    param: options.param ?? null,
    verify: options.verify ?? null,
  };
}

/** 时间格式化：秒 → mm:ss */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function describeWindow(w: TimeWindow | null): string {
  if (!w) return "全日志";
  return `${formatClock(w.startSec)} – ${formatClock(w.endSec)}`;
}

/** 报告头部用：机型 + 版本 + 规则库适配口径 */
export function firmwareLabel(meta: LogMeta): string {
  const version = meta.firmwareVersion ? ` ${meta.firmwareVersion}` : "";
  return `${meta.vehicle}${version}`.trim();
}

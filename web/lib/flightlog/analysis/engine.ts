/**
 * 诊断引擎：按 applies_to 门控逐条运行规则，汇总成报告。
 *
 * 门控是本引擎的**核心职责**：
 *  - 平台/版本不匹配 → not_applicable（附原因），绝不静默跳过；
 *  - 缺必需消息 → missing_required（列出缺哪些）；
 *  - 规则抛异常 → 兜底成 insufficient_data（规则本不该抛，但不能让一条规则拖垮整份报告）。
 */

import type { LogDocument } from "../types/log";
import type { Rule } from "../types/rule";
import type {
  DiagnosisReport,
  DiagnosisSummary,
  Finding,
  Severity,
} from "../types/report";
import { unknownFinding } from "./finding";
import { dataGapStep } from "./rules/tuningSteps";
import { createRuleContext } from "./context";
import { ALL_RULES } from "./rules";

/**
 * 用户要求「每一项都有建议」——**兜底**在这里：
 * 引擎自己产生的结论（平台/版本不匹配、缺必需消息、规则抛异常）不经过规则文件，
 * 若不给建议就会漏掉"每一项"。补一条**方向型**建议（不编数值），
 * 并说明缺什么、下一步该补什么数据。
 */
function ensureAdvice(f: Finding): Finding {
  if (f.suggestions.length > 0) return f;
  const howToFix =
    f.status === "not_applicable"
      ? "本规则不适用于当前机型/平台/版本，无需调参；同一份报告里其余结论仍然有效"
      : f.status === "missing_required"
        ? `按原因补齐缺失的消息/字段后复飞重采（${f.note ?? "见原因"}）`
        : "补足样本或满足前提条件后复飞重采";
  return {
    ...f,
    suggestions: [
      dataGapStep({
        signature: `${f.title} · ${f.status}`,
        missing: f.note ?? "规则未给出原因说明",
        howToFix,
        doc: f.docLinks[0] ?? "",
      }),
    ],
  };
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  ok: 3,
};

export function hasMessage(doc: LogDocument, name: string): boolean {
  if ((doc.messageCounts[name] ?? 0) > 0) return true;
  for (const key of Object.keys(doc.series)) {
    if (key === name || key.startsWith(`${name}:`)) return true;
  }
  return false;
}

function matchesPlatformAndVersion(
  doc: LogDocument,
  rule: Rule,
): Rule["appliesTo"][number] | null {
  for (const entry of rule.appliesTo) {
    if (entry.platform !== doc.meta.platform) continue;
    const v = doc.meta.versionNumeric;
    if (entry.minVersion !== undefined && v < entry.minVersion) continue;
    if (entry.maxVersion !== undefined && v > entry.maxVersion) continue;
    return entry;
  }
  return null;
}

function describeApplicability(doc: LogDocument, rule: Rule): string {
  const parts = rule.appliesTo.map((e) => {
    const range =
      e.minVersion === undefined && e.maxVersion === undefined
        ? "任意版本"
        : `≥ ${e.minVersion ?? 0}${e.maxVersion !== undefined ? ` 且 ≤ ${e.maxVersion}` : ""}`;
    return `${e.platform}（数值版本 ${range}）`;
  });
  const current = `${doc.meta.platform} ${doc.meta.firmwareVersion || "版本未知"}（数值 ${doc.meta.versionNumeric}）`;
  return `该规则适用于 ${parts.join(" 或 ")}，当前日志为 ${current}`;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((f, index) => ({ f, index }))
    .sort((a, b) => {
      const d = SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity];
      return d !== 0 ? d : a.index - b.index;
    })
    .map((x) => x.f);
}

export function summarize(findings: readonly Finding[]): DiagnosisSummary {
  const summary: DiagnosisSummary = { critical: 0, warning: 0, passed: 0, unknown: 0 };
  for (const f of findings) {
    if (f.severity === "critical") summary.critical += 1;
    else if (f.severity === "warning") summary.warning += 1;
    else if (f.severity === "ok") summary.passed += 1;
    else summary.unknown += 1;
  }
  return summary;
}

export interface AnalyzeOptions {
  rules?: readonly Rule[];
  parseMs?: number;
  analyzeMs?: number;
  fileName?: string;
  sizeBytes?: number;
}

export function analyzeLog(
  doc: LogDocument,
  options: AnalyzeOptions = {},
): DiagnosisReport {
  const rules = options.rules ?? ALL_RULES;
  const findings: Finding[] = [];

  for (const rule of rules) {
    const entry = matchesPlatformAndVersion(doc, rule);
    if (!entry) {
      findings.push(
        unknownFinding({
          ruleId: rule.id,
          title: rule.title,
          status: "not_applicable",
          note: describeApplicability(doc, rule),
        }),
      );
      continue;
    }
    const missing = entry.requires.filter((m) => !hasMessage(doc, m));
    if (missing.length > 0) {
      findings.push(
        unknownFinding({
          ruleId: rule.id,
          title: rule.title,
          status: "missing_required",
          note: `缺少必需消息：${missing.join("、")}${entry.note ? `（${entry.note}）` : ""}`,
        }),
      );
      continue;
    }
    try {
      findings.push(...rule.run(createRuleContext(doc)));
    } catch (error) {
      findings.push(
        unknownFinding({
          ruleId: rule.id,
          title: rule.title,
          status: "insufficient_data",
          note: `规则执行失败：${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  const sorted = sortFindings(findings.map(ensureAdvice));
  return {
    meta: doc.meta,
    fileName: options.fileName ?? "",
    sizeBytes: options.sizeBytes ?? 0,
    parseMs: options.parseMs ?? 0,
    analyzeMs: options.analyzeMs ?? 0,
    summary: summarize(sorted),
    findings: sorted,
  };
}

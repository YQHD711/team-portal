/**
 * 陷波规则的判定与文案层：把「证据 → 结论」这一步单独隔离，
 * 便于对每一类结论写独立测试（needsNotch / notNeeded / enabledNoPeak / enabledPeak / enabledUnverified）。
 *
 * ⚠️ 与配置自检（`notchConfigChecks.ts`）的关系：
 *   本文件负责「与振动/FFT 结论是否一致」，配置自检负责「配置本身是否合理」。
 *   最终严重度取两者的**较严重者**——这样不会再出现"证据写着 ATT 超限、结论却是通过"的自相矛盾。
 *   同时**每一条结论都带建议**（用户：「每一项都有建议」），ok/unknown 一侧也给方向 + 缺什么数据。
 */

import type { CheckStatus, Severity, Suggestion } from "../types/report";
import { notchConfigIssues, type NotchConfigIssue } from "./notchConfigChecks";
import type { VibrationIndicator } from "./vibrationIndicators";
import { vibrationBad } from "./vibrationIndicators";
import type { FtnSummary, NotchConfig } from "./notchEvidence";
import { VIBRATION } from "./thresholds";
import { buildBase } from "./notchVerdictTexts";

export interface NotchEvidence {
  cfg: NotchConfig;
  ftn: FtnSummary | null;
  indicators: VibrationIndicator[];
  vibrationUnavailable: string | null;
  worstStd: number;
  imuFs: number | null;
}

export type NotchDecision =
  | { kind: "needsNotch"; severe: boolean }
  | { kind: "notNeeded" }
  | { kind: "vibrationUnmeasurable" }
  | { kind: "enabledNoPeak"; snrMax: number }
  | { kind: "enabledPeak"; peakHz: number; offset: number }
  | { kind: "enabledUnverified" };

export interface NotchVerdict {
  severity: Severity;
  /** 覆盖由 severity 推导的默认状态（例如"振动测不出来"应为 insufficient_data） */
  status?: CheckStatus;
  phenomenon: string;
  impact: string;
  suggestions: Suggestion[];
}

/** 振动判据与建议实现都拆在独立模块，这里保持原导出名以兼容既有 import */
export { vibrationBad } from "./vibrationIndicators";

export function decideNotch(ev: NotchEvidence): NotchDecision {
  const cfg = ev.cfg;
  if (!cfg.enabled) {
    // 振动测不出来时**不能**说"振动在阈值内、无需启用"——那是把未知说成通过
    if (ev.vibrationUnavailable !== null) return { kind: "vibrationUnmeasurable" };
    if (!vibrationBad(ev.indicators)) return { kind: "notNeeded" };
    const severe = ev.indicators.some(
      (i) => i.clipDelta >= VIBRATION.clipDeltaCritical || i.worstStd >= VIBRATION.stdCritical,
    );
    return { kind: "needsNotch", severe };
  }
  if (ev.ftn && ev.ftn.snrDb.length > 0) {
    const snrMax = Math.max(...ev.ftn.snrDb);
    if (snrMax <= cfg.snrRef) return { kind: "enabledNoPeak", snrMax };
    if (cfg.freq !== null && cfg.freq > 0) {
      const peakHz = Math.max(...ev.ftn.peakHz);
      return { kind: "enabledPeak", peakHz, offset: peakHz > 0 ? Math.abs(cfg.freq - peakHz) / peakHz : 0 };
    }
  }
  return { kind: "enabledUnverified" };
}

const RANK: Readonly<Record<Severity, number>> = { critical: 0, warning: 1, unknown: 2, ok: 3 };

/** 基准结论 + 配置自检 → 最终文案（严重度取较严重者，建议合并去重） */
function merge(base: NotchVerdict, issues: readonly NotchConfigIssue[]): NotchVerdict {
  const hard = issues.filter((i) => i.severity === "warning" || i.severity === "critical");
  // 严重度取「基准结论」与「配置自检」的较严重者：
  //  - 配置问题是**已知事实**，即使基准结论落在 unknown（例如没有 FFT 数据）也必须告警，
  //    否则又会出现"证据写着 ATT 超限、结论却是无法判断"的隐蔽版本；
  //  - ok 不会被降级；critical 保持 critical。
  let severity: Severity = base.severity;
  for (const issue of hard) {
    if (RANK[issue.severity] < RANK[severity]) severity = issue.severity;
  }
  const status: CheckStatus | undefined = severity === base.severity ? base.status : "fired";
  const suggestions: Suggestion[] = [...base.suggestions];
  for (const issue of issues) {
    if (!suggestions.some((s) => s.param?.name === issue.suggestion.param?.name && s.text === issue.suggestion.text)) {
      suggestions.push(issue.suggestion);
    }
  }
  return {
    severity,
    status,
    phenomenon: hard.length > 0 ? `${base.phenomenon}；另：${hard.map((i) => i.text).join("；")}` : base.phenomenon,
    impact: base.impact,
    suggestions: suggestions.map((s, i) => ({ ...s, order: i + 1 })),
  };
}

export function verdictFor(d: NotchDecision, ev: NotchEvidence): NotchVerdict {
  const std = ev.worstStd.toFixed(2);
  const clipTotal = ev.indicators.reduce((s, i) => s + i.clipDelta, 0);
  const issues = notchConfigIssues(ev.cfg, ev.ftn && ev.ftn.peakHz.length > 0 ? Math.max(...ev.ftn.peakHz) : null);
  const rank = (a: Severity): number => RANK[a];
  const base = buildBase(d, ev, std, clipTotal);
  return merge({ ...base, suggestions: [...base.suggestions].sort(() => 0) }, issues.sort((a, b) => rank(a.severity) - rank(b.severity)));
}

export function configText(cfg: NotchConfig): string {
  if (!cfg.enabled) return "INS_HNTCH_ENABLE=0（谐波陷波未启用）";
  return `已启用：FREQ=${cfg.freq ?? "?"} Hz BW=${cfg.bw ?? "?"} Hz ATT=${cfg.att ?? "?"} dB MODE=${cfg.mode ?? "?"} HMNCS=${cfg.hmNcs ?? "?"}`;
}

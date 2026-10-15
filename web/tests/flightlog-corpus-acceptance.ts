/**
 * task-32 四条要求的**语料验收采集**（从 flightlog-rules-corpus-fixture.ts 拆出：原文件超过 200 行）。
 *
 * 四条要求：① 每一项都要有建议；② 滤波自相矛盾（ATT 过深 / FREQ 偏差边界）不得判 passed；
 * ③ 结构性 not_applicable 必须带原因；④ 降落/坠机冲击必须从常规振动里排除并单列。
 *
 * 刻意放在**同一遍解析**里采集：再跑一遍 76 个 .bin 会让 vitest worker 的 RPC 心跳超时
 * （已知 `[vitest-worker]: Timeout calling "onTaskUpdate"` → 整轮 exit 1）。
 */

import { analyzeLog } from "../lib/flightlog/analysis/engine";
import { readFtn1, readNotchConfig } from "../lib/flightlog/analysis/notchEvidence";
import { vibrationRule } from "../lib/flightlog/analysis/rules/vibration";
import { VIBRATION } from "../lib/flightlog/analysis/thresholds";
import { segmentStats } from "../lib/flightlog/analysis/vibrationInstance";
import { longestWindow } from "../lib/flightlog/analysis/windows";
import type { RuleContext } from "../lib/flightlog/types/rule";

/** task-32 的四条要求在这份日志上的实测结果 */
export interface AcceptanceRow {
  engineFindings: number;
  /** 引擎全量结论的状态分布（新旧对比用） */
  engineStatuses: Record<string, number>;
  noSuggestions: string[];
  naWithoutNote: number;
  /** ATT>20 dB 却判 passed（修复前会漏） */
  notchViolations: number;
  /** FREQ 与机上 FFT 主峰偏差 ≥20% 却判 passed（旧实现 `>0.2` 会放过边界） */
  freqViolations: number;
  attSeen: number;
  freqOffsetSeen: number;
  /** 常规振动统计是否排除了识别出的降落段（证据里能读到） */
  landingExcluded: number;
  /** 独立的"触地/坠机冲击"结论条数 */
  landingFindings: number;
  /** 旧口径（整段 arm 窗口，含落地冲击）与新口径（排除降落段）的振动严重度 */
  vibrationOld: string;
  vibrationNew: string;
}

export function acceptanceOf(ctx: RuleContext): AcceptanceRow {
  const report = analyzeLog(ctx.doc);
  const engineStatuses: Record<string, number> = {};
  const noSuggestions: string[] = [];
  let naWithoutNote = 0;
  for (const f of report.findings) {
    engineStatuses[f.status] = (engineStatuses[f.status] ?? 0) + 1;
    if (f.suggestions.length === 0) noSuggestions.push(`${f.ruleId}:${f.title}`);
    if (f.status === "not_applicable" && !f.note) naWithoutNote += 1;
  }
  const cfg = readNotchConfig(ctx);
  const filter = report.findings.find((f) => f.ruleId === "filter_notch");
  const ftn = readFtn1(ctx);
  const peakHz = ftn && ftn.peakHz.length > 0 ? Math.max(...ftn.peakHz) : null;
  const attSeen = cfg.att !== null && cfg.att > 20;
  const freqOffsetSeen =
    cfg.freq !== null && cfg.freq > 0 && peakHz !== null && peakHz > 0 &&
    Math.abs(cfg.freq - peakHz) / peakHz >= 0.2;

  const vibAll = vibrationRule.run(ctx);
  const vib = vibAll.filter((f) => f.title.startsWith("振动超标"));
  const armed = longestWindow(ctx.armedWindows());
  let oldWorst = 0;
  let oldClipCritical = false;
  let oldClipAny = 0;
  if (armed) {
    const instances = Object.keys(ctx.doc.series)
      .filter((k) => k.startsWith("VIBE:"))
      .map((k) => Number(k.slice("VIBE:".length)));
    for (const inst of instances) {
      const s = segmentStats(ctx, inst, armed, VIBRATION.minSamples);
      if (s) oldWorst = Math.max(oldWorst, ...s.axes.map((a) => a.std));
      const c = ctx.windowed("VIBE", "Clip", armed, inst);
      if (c && c.values.length >= 2) {
        const delta = c.values[c.values.length - 1] - c.values[0];
        oldClipAny = Math.max(oldClipAny, delta);
        if (delta >= VIBRATION.clipDeltaCritical) oldClipCritical = true;
      }
    }
  }
  return {
    engineFindings: report.findings.length,
    engineStatuses,
    noSuggestions,
    naWithoutNote,
    notchViolations: attSeen && filter?.status === "passed" ? 1 : 0,
    freqViolations: freqOffsetSeen && filter?.status === "passed" ? 1 : 0,
    attSeen: attSeen ? 1 : 0,
    freqOffsetSeen: freqOffsetSeen ? 1 : 0,
    landingExcluded: vib.some((f) => f.evidence.some((e) => e.detail.includes("排除降落段"))) ? 1 : 0,
    landingFindings: vibAll.filter((f) => f.title.includes("冲击")).length,
    vibrationOld: oldClipCritical || oldWorst >= VIBRATION.stdCritical
      ? "critical"
      : oldWorst >= VIBRATION.stdWarning || oldClipAny > 0
        ? "warning"
        : "ok",
    vibrationNew: vib.map((f) => f.severity).sort().join(",") || "none",
  };
}

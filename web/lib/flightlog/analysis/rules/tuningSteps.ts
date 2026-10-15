/**
 * 「每一项都要有建议」的统一构造：把六要素固化成一处，避免每条规则各写一遍。
 *
 * 六要素（用户明确要求）：**触发签名 → 当前值 → 建议值 → 推导依据 → 复飞验证指标 → 官方文档**。
 *
 * 三条纪律：
 *  ① **数值只能是"起点值"**：真值需要阶跃响应/系统辨识，日志里没有——必须在建议里说出来；
 *  ② **算不出数值就给方向 + 说清缺什么数据**，绝不编数（编出来的数会让用户白调一圈）；
 *  ③ **通过（ok）的结论也要给建议**：用户原话「不是说通过就行了」——"当前够用"不等于"没有改进空间"。
 */

import type { ChartRequest, Finding, Severity, Suggestion } from "../../types/report";
import type { TimeWindow } from "../../types/log";
import { makeFinding } from "../finding";

export interface TuningStepArgs {
  order: number;
  /** ① 触发签名：实测到的现象/数字（必须来自日志） */
  signature: string;
  /** ② 当前值：参数当前值或当前实测值 */
  current: string;
  /** ③ 建议值：具体数值（起点值）或方向 + 缺什么数据 */
  suggested: string;
  /** ④ 推导依据：算式 / 物理依据 / 官方口径 */
  basis: string;
  /** ⑤ 复飞验证指标 */
  verify: string;
  /** ⑥ 官方文档 */
  doc: string;
  /** 有确切目标值时给出参数改动；没有就传 null（宁可不给数） */
  param?: { name: string; from: number | null; to: number; reason: string } | null;
}

/** 六要素建议（文本里逐条标号，UI 与测试都能看出缺了哪一项） */
export function tuningStep(args: TuningStepArgs): Suggestion {
  const text = [
    `①触发签名：${args.signature}`,
    `②当前值：${args.current}`,
    `③建议值：${args.suggested}`,
    `④推导依据：${args.basis}`,
    `⑤复飞验证：${args.verify}`,
    `⑥官方文档：${args.doc}`,
  ].join("；");
  return {
    order: args.order,
    text,
    param: args.param ?? null,
    verify: args.verify,
  };
}

/**
 * 「当前配置没问题，但仍有改进空间」的建议（用于 ok / passed 结论）。
 * 不编数值：给方向 + 明确说明"要给出具体数值还缺哪份数据"。
 */
export function improvementStep(args: {
  order?: number;
  signature: string;
  current: string;
  direction: string;
  missing: string;
  verify: string;
  doc: string;
}): Suggestion {
  return tuningStep({
    order: args.order ?? 1,
    signature: args.signature,
    current: args.current,
    suggested: `${args.direction}（未给绝对数值：${args.missing}）`,
    basis: "当前值落在合理范围，属于「可选优化」而非必须项；要给出绝对起点值需要阶跃响应/系统辨识数据",
    verify: args.verify,
    doc: args.doc,
  });
}

/**
 * unknown 一侧（缺数据/不适用/无法判断）的建议：**先补齐判据所需的数据**。
 * 纪律：不适用也要给"下一步该看什么"，但绝不给参数数值。
 */
export function dataGapStep(args: {
  order?: number;
  signature: string;
  missing: string;
  howToFix: string;
  doc: string;
}): Suggestion {
  return tuningStep({
    order: args.order ?? 1,
    signature: args.signature,
    current: `无法评估：${args.missing}`,
    suggested: `先补齐数据再判断：${args.howToFix}`,
    basis: "缺少判据所需的数据时不下结论（把未知说成通过是反复踩过的坑）",
    verify: "补齐数据后复飞一次，让本条结论从「无法判断」变成有依据的通过/警告",
    doc: args.doc,
  });
}

export interface AdviceFindingInit {
  ruleId: string;
  title: string;
  reason: string;
  suggestions: readonly Suggestion[];
  docLinks: readonly string[];
  window?: TimeWindow | null;
  axis?: Finding["axis"];
  evidence?: Finding["evidence"];
  metrics?: Readonly<Record<string, number>>;
  charts?: readonly ChartRequest[];
}

/**
 * unknown 一侧 + 建议：`unknownFinding()` 不接受 suggestions，
 * 所以这里用 `makeFinding` 直接构造（保持 severity=unknown / status 落 unknown 一侧）。
 */
export function unknownWithAdvice(
  init: AdviceFindingInit & { status: "not_applicable" | "missing_required" | "insufficient_data" | "checked_but_not_supported" },
): Finding {
  return makeFinding({
    ruleId: init.ruleId,
    title: init.title,
    severity: "unknown" as Severity,
    status: init.status,
    window: init.window ?? null,
    axis: init.axis ?? null,
    phenomenon: "未能完成检查",
    impact: "无法判断该方面是否存在问题，不代表通过",
    note: init.reason,
    evidence: init.evidence ?? [],
    metrics: init.metrics ?? {},
    suggestions: init.suggestions,
    docLinks: init.docLinks,
    charts: init.charts ?? [],
  });
}

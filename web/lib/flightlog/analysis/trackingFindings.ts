/**
 * 外环跟踪结论的统一构造：把"激励门槛 → 分档 → 现象/影响/建议/证据"固化一处，
 * 避免角度环与速度/位置环各写一遍（也避免两处判据口径漂移）。
 *
 * 三条纪律（对应契约 §3.3 与 task-27 硬性要求）：
 *  ① 激励不足 → `insufficient_data` + **门槛数字**，并在 note 里写明"不代表通过"；
 *  ② 偏差列恒为 0 → `insufficient_data`（"没有数据"不等于"跟踪完美"）；
 *  ③ 缺列/缺消息 → `missing_required`/`not_applicable` 只在**该通道**生效（见 trackingUnknowns.ts）。
 */

import type { ChartRequest, EvidenceStep, Finding, Suggestion } from "../types/report";
import { makeFinding, step, unknownFinding } from "./finding";
import { dataGapStep } from "./rules/tuningSteps";
import type { TrackingPair } from "./trackingEvidence";

export type Severity = "critical" | "warning" | "ok";

export function gradeRatio(ratio: number, warning: number, critical: number): Severity {
  if (ratio >= critical) return "critical";
  if (ratio >= warning) return "warning";
  return "ok";
}

export function gradeAbsolute(value: number, warning: number, critical: number): Severity {
  if (value >= critical) return "critical";
  if (value >= warning) return "warning";
  return "ok";
}

export interface ChannelArgs {
  ruleId: string;
  ruleTitle: string;
  /** 结论面向的通道名，如 "Roll 角度环" / "北向速度环" */
  subject: string;
  axis: Finding["axis"];
  pair: TrackingPair;
  /** ratio = 误差/指令 比值判据；absolute = 绝对误差判据（角度用度、位置/航迹/高度用米） */
  mode: "ratio" | "absolute";
  errorUnit: string;
  excitationUnit: string;
  /** ratio 模式 = 比值阈值；absolute 模式 = 绝对阈值（errorUnit） */
  warning: number;
  critical: number;
  /**
   * 激励门槛，**只对 ratio 判据有效**（比值在小分母下会放大）。
   * absolute 判据（角度/米）**必须不传**：30° 的姿态误差或 30 m 的高度偏差与"指令有多小"
   * 无关，用门槛挡掉它就是把最该看见的日志藏起来（Lead 裁决 2，2026-10）。
   */
  minExcitation?: number;
  chart: ChartRequest;
  docLinks: readonly string[];
  /** 通过（ok）与触发（fired）时给的调参/改进建议（六要素） */
  suggestions: readonly Suggestion[];
  /** 该通道**实际**采用的激励口径文案（不同平台不同：PX4 低激励且误差小判无法评价）；不传则用绝对量判据的默认文案 */
  excitationPolicyNote?: string;
  /** unknown 一侧（无法判断）时的建议：默认给"先补齐判据所需数据"，**绝不带参数数值** */
  unknownAdvice?: readonly Suggestion[];
  /** 偏差列专用：整段恒为 0 → 说明没有数据（不是"跟踪完美"） */
  zeroDeviationIsUnknown?: boolean;
}

/** unknown 一侧的兜底建议：给方向 + 说清缺什么，不编数值 */
function gapAdvice(args: ChannelArgs): readonly Suggestion[] {
  if (args.unknownAdvice && args.unknownAdvice.length > 0) return args.unknownAdvice;
  return [
    dataGapStep({
      signature: `${args.subject}无法判定（缺数据或样本不足）`,
      missing: args.pair.isDeviation
        ? "该偏差列整段为 0，说明本次没有产生可用数据"
        : "本次飞行缺少该通道的可用样本",
      howToFix: "按同一载重/场地复飞一次，让该通道在飞行中出现明显机动（航线、定点加速、爬升下降）",
      doc: args.docLinks[0] ?? "",
    }),
  ];
}

function evidenceFor(args: ChannelArgs): EvidenceStep[] {
  const { pair } = args;
  const yawStd = args.mode === "absolute" && args.axis === "yaw";
  return [
    step("统计区间", `${pair.message}：样本 ${pair.samples} 条`
      + `${pair.sampleRateHz ? `，记录率约 ${pair.sampleRateHz.toFixed(1)} Hz` : ""}`),
    step(
      "指令激励",
      pair.isDeviation
        ? "该列是**偏差列**（目标恒为 0），无指令激励概念；用飞行是否真的产生偏差来判定"
        : args.minExcitation === undefined
          ? args.excitationPolicyNote
            ?? `目标${yawStd ? "标准差" : " RMS"} ${pair.excitement.toFixed(3)} ${args.excitationUnit}`
              + "；本通道是**绝对量判据**，不设激励门槛（指令多小都看），只看样本数与绝对误差"
          : `目标${yawStd ? "标准差" : " RMS"} ${pair.excitement.toFixed(3)} ${args.excitationUnit}`
            + `（门槛 ${args.minExcitation} ${args.excitationUnit}；比值判据在小分母下会放大，故先确认指令够大）`,
    ),
    step(
      "误差统计",
      `误差 RMS ${pair.errorRms.toFixed(4)} ${args.errorUnit}，峰值 ${pair.maxAbsError.toFixed(4)} ${args.errorUnit}`
      + (pair.isDeviation || !Number.isFinite(pair.ratio) ? "" : `，误差/目标 ${pair.ratio.toFixed(3)}`),
    ),
    step(
      "判据",
      args.mode === "ratio"
        ? `误差/目标：警告 ${args.warning} / 严重 ${args.critical}（无量纲比值）`
        : `绝对误差：警告 ${args.warning} ${args.errorUnit} / 严重 ${args.critical} ${args.errorUnit}`,
    ),
  ];
}

function metricsFor(args: ChannelArgs): Record<string, number> {
  const { pair } = args;
  const metrics: Record<string, number> = {
    errRms: pair.errorRms,
    maxAbsErr: pair.maxAbsError,
    targetRms: pair.targetRms,
    excitement: pair.excitement,
    samples: pair.samples,
    sampleRateHz: pair.sampleRateHz ?? 0,
  };
  // ⚠️ **绝对量判据下不要输出 errRatio**：早先为了类型完整写了 `Number.isFinite(ratio) ? ratio : -1`，
  //    结果卡片上出现「errRatio -1.00」——RMS 比值不可能是 −1，那是个哨兵值被当成指标展示了。
  //    没有这个量就**不输出**，让 UI 直接不显示（比显示一个假数字好）。
  if (Number.isFinite(pair.ratio)) metrics.errRatio = pair.ratio;
  return metrics;
}

/** 生成一条通道结论（含激励门槛、恒 0 守卫、分档与建议） */
export function channelFinding(args: ChannelArgs): Finding {
  const { pair } = args;
  const common = {
    ruleId: args.ruleId,
    title: `${args.ruleTitle}（${args.subject}）`,
    axis: args.axis,
    window: pair.window,
    docLinks: args.docLinks,
    charts: [args.chart],
    metrics: metricsFor(args),
  };
  const evidence = evidenceFor(args);

  // 守卫 1：偏差列恒为 0 → 没有数据（真实语料里 4/9 份 Plane 的 XT 就是这样）
  if (args.zeroDeviationIsUnknown && pair.maxAbsError <= 1e-9) {
    return makeFinding({
      ...common,
      severity: "unknown",
      status: "insufficient_data",
      phenomenon: `${args.subject}整段恒为 0：本次飞行没有产生可评价的${args.subject}数据`,
      impact: "无法判断该通道跟踪是否正常，不代表通过",
      evidence,
      suggestions: gapAdvice(args),
      note: "偏差列恒为 0 说明该通道本次没有被使用（例如没飞航线/没有高度目标），"
        + "不能当作\"跟踪完美\"；如需评估请在带航线或高度目标的飞行里复飞分析。",
    });
  }

  // 守卫 2：激励不足 → 不做判定。
  // ⚠️ 只对 ratio 判据生效（args.minExcitation 有值）；absolute 判据不传门槛，
  //    因为"绝对误差"跟指令大小无关，挡掉它会把最该看见的日志藏起来（Lead 裁决 2）。
  if (args.minExcitation !== undefined && !pair.isDeviation && pair.excitement < args.minExcitation) {
    const measured = args.mode === "absolute" && args.axis === "yaw" ? "标准差" : "RMS";
    return makeFinding({
      ...common,
      severity: "unknown",
      status: "insufficient_data",
      phenomenon: `本次飞行 ${args.subject} 指令过小：目标 ${measured} `
        + `${pair.excitement.toFixed(3)} ${args.excitationUnit}（门槛 ${args.minExcitation} ${args.excitationUnit}），无法评价跟踪质量`,
      impact: "无法判断该通道是否正常，不代表通过",
      evidence,
      suggestions: gapAdvice(args),
      note: `指令激励不足（门槛 ${args.minExcitation} ${args.excitationUnit}）时"误差/指令"比会天然放大，`
        + "因此该通道不做判定，结论**不代表通过**；若需要对这条通道下结论，"
        + "请在飞行中给出明显的角度/速度机动（航线飞行、定点加速、爬升下降）后复飞分析。",
    });
  }

  const severity =
    args.mode === "ratio"
      ? gradeRatio(pair.ratio, args.warning, args.critical)
      : gradeAbsolute(pair.errorRms, args.warning, args.critical);
  const measured =
    args.mode === "ratio"
      ? `误差/目标 ${pair.ratio.toFixed(3)}`
      : `误差 RMS ${pair.errorRms.toFixed(3)} ${args.errorUnit}（峰值 ${pair.maxAbsError.toFixed(3)}）`;

  if (severity === "ok") {
    return makeFinding({
      ...common,
      severity: "ok",
      status: "passed",
      phenomenon: `${args.subject}跟踪良好：${measured}`,
      impact: "该通道能跟随指令，不构成控制风险",
      evidence,
      // 用户要求「每一项都有建议」：通过也要给改进建议（六要素，数值是起点值/或只给方向）
      suggestions: args.suggestions,
    });
  }
  return makeFinding({
    ...common,
    severity,
    status: "fired",
    phenomenon: `${args.subject}跟踪偏差偏大：${measured}`,
    impact: "该通道偏差会表现为姿态/速度/轨迹误差，并随风、重心、振动与参数问题放大",
    evidence,
    suggestions: args.suggestions,
  });
}


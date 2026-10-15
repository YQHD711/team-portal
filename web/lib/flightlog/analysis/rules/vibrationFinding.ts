/**
 * 振动常规结论的构造（从 vibration.ts 拆出：原文件超过 200 行上限）。
 *
 * 常规结论只看**排除降落段之后**的飞行段；降落段单独成结论（见 vibrationLanding.ts）。
 * 每一条结论都必须带建议（用户：「每一项都有建议」），ok 一侧给方向 + 说明缺什么数据。
 */

import type { Finding, ChartRequest } from "../../types/report";
import { makeFinding, step, describeWindow } from "../finding";
import { improvementStep, tuningStep } from "./tuningSteps";
import type { VibrationIndicator } from "../vibrationIndicators";
import { VIBRATION } from "../thresholds";

export const VIB_DOC = "https://ardupilot.org/copter/docs/common-measuring-vibration.html";
export const VIB_RULE_ID = "vibration_level";
export const VIB_TITLE = "振动超标";

export function chartsFor(ind: VibrationIndicator): ChartRequest[] {
  return [
    {
      id: `${VIB_RULE_ID}-imu${ind.instance}-vibe`,
      kind: "timeseries",
      title: `IMU${ind.instance} 振动水平（m/s²）${ind.excluded ? "（已排除降落段）" : ""}`,
      signals: [
        { series: "VIBE", field: "VibeX", instance: ind.instance, label: "X" },
        { series: "VIBE", field: "VibeY", instance: ind.instance, label: "Y" },
        { series: "VIBE", field: "VibeZ", instance: ind.instance, label: "Z" },
      ],
      window: ind.armedWindow,
      thresholds: [
        { value: VIBRATION.stdWarning, label: `警告 ${VIBRATION.stdWarning}`, axis: "y" },
        { value: VIBRATION.stdCritical, label: `严重 ${VIBRATION.stdCritical}`, axis: "y" },
      ],
      peakMarkers: [],
      // 高亮优先给超标段；没有超标时高亮降落段，让"排除了哪一段"看得见
      highlightWindow: ind.exceedWindow ?? ind.landing?.window ?? null,
      spectrum: null,
    },
  ];
}

/** 降落段处理写进证据（依据 + 可信度 + 实测数字），不允许只有结论没有出处 */
export function exclusionEvidence(ind: VibrationIndicator): ReturnType<typeof step> {
  if (!ind.excluded) {
    return step("降落段处理", "未识别出降落段（无可用的 disarm/MODE/EV/Alt 线索），常规振动统计**包含**落地冲击");
  }
  return step(
    "降落段处理",
    `已从常规统计中排除降落段 ${describeWindow(ind.excluded.window)}（依据：${ind.excluded.basis}）` +
      (ind.landing
        ? `；该段实测：最差轴 ${ind.landing.worstAxis.toUpperCase()} std ${ind.landing.worstStd.toFixed(2)} m/s²、峰值 ${ind.landing.max.toFixed(1)} m/s²、clip 增量 ${ind.landing.clipDelta}`
        : "；该段样本不足 5 条，未单独统计"),
  );
}

export function metricsOf(ind: VibrationIndicator): Record<string, number> {
  return {
    stdX: ind.axes[0].std,
    stdY: ind.axes[1].std,
    stdZ: ind.axes[2].std,
    maxX: ind.axes[0].max,
    maxY: ind.axes[1].max,
    maxZ: ind.axes[2].max,
    clipDelta: ind.clipDelta,
    samples: ind.samples,
    landingClipDelta: ind.landing?.clipDelta ?? 0,
    landingWorstStd: ind.landing?.worstStd ?? 0,
  };
}

export function buildFinding(ind: VibrationIndicator, imuCount: number): Finding {
  const failed = ind.clipDelta >= VIBRATION.clipDeltaCritical;
  const byStd =
    ind.worstStd >= VIBRATION.stdCritical ? "critical" : ind.worstStd >= VIBRATION.stdWarning ? "warning" : "ok";
  const severity = failed ? "critical" : byStd;
  const label = imuCount > 1 ? `${VIB_TITLE}（IMU${ind.instance}）` : VIB_TITLE;
  const axisText = ind.axes
    .map((a) => `${a.axis.toUpperCase()} std ${a.std.toFixed(2)} / max ${a.max.toFixed(1)}`)
    .join("，");
  const evidence = [
    step("统计区间", `${describeWindow(ind.window)}（arm 窗口 ${describeWindow(ind.armedWindow)}），样本 ${ind.samples} 条`),
    exclusionEvidence(ind),
    step("各轴振动水平", axisText),
    step("阈值来源", `ArduPilot 官方：Vibe 应低于 ${VIBRATION.stdWarning}，必须低于 ${VIBRATION.stdCritical}；clipping 必须为 0`),
    step("判据", `最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)}；clip 计数增量 ${ind.clipDelta}`),
  ];
  const base = {
    ruleId: VIB_RULE_ID,
    title: label,
    window: ind.armedWindow,
    evidence,
    metrics: metricsOf(ind),
    docLinks: [VIB_DOC],
    charts: chartsFor(ind),
  };
  const exclusionNote = ind.excluded
    ? `常规振动统计已排除降落段（${describeWindow(ind.excluded.window)}）：${ind.excluded.basis}`
    : "未能识别降落段，常规统计包含落地冲击；若数值异常集中在最后几秒，请按「降落/触地冲击」判读。";

  if (severity === "ok") {
    return makeFinding({
      ...base,
      severity: "ok",
      status: "passed",
      phenomenon: `振动在阈值内：最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²，clip 增量 ${ind.clipDelta}`,
      impact: "振动未对 IMU 与姿态估计构成威胁",
      suggestions: [
        improvementStep({
          signature: `振动在阈值内（最差轴 ${ind.worstAxis.toUpperCase()} std ${ind.worstStd.toFixed(2)} m/s²，clip 增量 ${ind.clipDelta}）`,
          current: `最差轴标准差 ${ind.worstStd.toFixed(2)}（警告线 ${VIBRATION.stdWarning}、严重线 ${VIBRATION.stdCritical}）`,
          direction: "保持现有减振与桨平衡状态；换桨/改载后按同一标准复测，可用 INS_LOG_BAT_MASK=1 采一次频谱留基线",
          missing: "没有机上 FFT（INS_LOG_BAT_MASK=1）数据时无法给出「该关注哪个频段」的数值结论",
          verify: `复飞后最差轴标准差仍低于 ${VIBRATION.stdWarning}、clip 增量保持 0`,
          doc: VIB_DOC,
        }),
      ],
      note: exclusionNote,
    });
  }

  return makeFinding({
    ...base,
    severity,
    status: "fired",
    phenomenon: failed
      ? `IMU${ind.instance} 加速度计发生饱和：飞行段内 clip 计数增加 ${ind.clipDelta}；最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²`
      : `IMU${ind.instance} 振动水平偏高：最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²（阈值 ${VIBRATION.stdWarning}）`,
    impact: failed
      ? "加速度计饱和会直接污染姿态估计与振动补偿，可能诱发 EKF 失效与姿态抖动"
      : "持续振动会加速 IMU 漂移、降低姿态估计精度，长期还会加剧舵机与机架疲劳",
    suggestions: [
      tuningStep({
        order: 1,
        signature: failed
          ? `飞行段 clip 增量 ${ind.clipDelta}（官方要求为 0）`
          : `最差轴 ${ind.worstAxis.toUpperCase()} std ${ind.worstStd.toFixed(2)} ≥ 警告线 ${VIBRATION.stdWarning}`,
        current: `stdX/Y/Z = ${ind.axes.map((a) => a.std.toFixed(2)).join("/")}，clip 增量 ${ind.clipDelta}`,
        suggested: failed
          ? "先停飞：按机械检查清单处理（桨动平衡、桨夹间隙、电机轴承、飞控减振、线束刚性耦合）后再复飞"
          : "先处理机械振动（桨动平衡与紧固件）→ 复测；若仍偏高再按滤波规则顺序处理滤波",
        basis: "官方：振动是机械问题的结果，先机械后滤波；clip>0 说明加速度计饱和，参数层面无法补偿",
        verify: `复飞后最差轴 std 降到 ${VIBRATION.stdWarning} 以下且 clip 增量保持 0`,
        doc: VIB_DOC,
      }),
      improvementStep({
        order: 2,
        signature: "需要定位频段/谐波才能进一步优化滤波",
        current: "当前日志没有机上 FFT 结论",
        direction: "设 INS_LOG_BAT_MASK=1 复飞一次，取得 FTN1/FTN2 后再由滤波规则给出频率与深度建议",
        missing: "没有机上频谱数据时无法判断是窄带共振还是宽谱振动",
        verify: "FTN1 主峰 SNR 低于参考值，VIBE 标准差下降 ≥30%",
        doc: VIB_DOC,
      }),
    ],
    note: exclusionNote,
  });
}

/**
 * 规则 1：振动超标（分 IMU）
 *
 * 数据来源 VIBE（飞控内部在原始 1 kHz 加速度上算出的振动水平，日志里约 10 Hz）。
 * 三个独立信号交叉验证：
 *   ① 各轴振动标准差（持续振动）
 *   ② 峰值（瞬时冲击）
 *   ③ clip 计数增量（加速度计饱和次数 —— 官方要求必须为 0）
 *
 * 实测标定（6 份真实日志）：健康机 std 0.68~3.31、clip 恒为 0；
 * 故障机 clip 增量 62 / 73 / 112 / 165 / 192，峰值 71~107 m/s²。
 * 只用标准差会漏掉"偶发冲击"，只用峰值会漏掉"持续振动"，所以三者必须同看。
 */

import type { Finding, ChartRequest } from "../../types/report";
import type { Rule } from "../../types/rule";
import { makeFinding, step, suggestion, unknownFinding, describeWindow } from "../finding";
import { scanVibration, type VibrationIndicator } from "../vibrationIndicators";
import { VIBRATION } from "../thresholds";

const RULE_ID = "vibration_level";
const TITLE = "振动超标";
const DOC = "https://ardupilot.org/copter/docs/common-measuring-vibration.html";

function chartsFor(ind: VibrationIndicator): ChartRequest[] {
  return [
    {
      id: `${RULE_ID}-imu${ind.instance}-vibe`,
      kind: "timeseries",
      title: `IMU${ind.instance} 振动水平（m/s²）`,
      signals: [
        { series: "VIBE", field: "VibeX", instance: ind.instance, label: "X" },
        { series: "VIBE", field: "VibeY", instance: ind.instance, label: "Y" },
        { series: "VIBE", field: "VibeZ", instance: ind.instance, label: "Z" },
      ],
      window: ind.window,
      thresholds: [
        { value: VIBRATION.stdWarning, label: `警告 ${VIBRATION.stdWarning}`, axis: "y" },
        { value: VIBRATION.stdCritical, label: `严重 ${VIBRATION.stdCritical}`, axis: "y" },
      ],
      peakMarkers: [],
      highlightWindow: ind.exceedWindow,
      spectrum: null,
    },
  ];
}

function buildFinding(ind: VibrationIndicator, imuCount: number): Finding {
  const failed = ind.clipDelta >= VIBRATION.clipDeltaCritical;
  const byStd =
    ind.worstStd >= VIBRATION.stdCritical
      ? "critical"
      : ind.worstStd >= VIBRATION.stdWarning
        ? "warning"
        : "ok";
  const severity = failed ? "critical" : byStd;
  const label = imuCount > 1 ? `${TITLE}（IMU${ind.instance}）` : TITLE;

  const axisText = ind.axes
    .map((a) => `${a.axis.toUpperCase()} std ${a.std.toFixed(2)} / max ${a.max.toFixed(1)}`)
    .join("，");

  const evidence = [
    step(
      "统计区间",
      `${describeWindow(ind.window)}，样本 ${ind.samples} 条（飞行段内 VIBE 记录）`,
    ),
    step("各轴振动水平", axisText),
    step(
      "阈值来源",
      `ArduPilot 官方：Vibe 应低于 ${VIBRATION.stdWarning}，必须低于 ${VIBRATION.stdCritical}；clipping 必须为 0`,
    ),
    step(
      "判据",
      `最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)}；clip 计数增量 ${ind.clipDelta}`,
    ),
  ];

  if (severity === "ok") {
    return makeFinding({
      ruleId: RULE_ID,
      title: label,
      severity: "ok",
      status: "passed",
      window: ind.window,
      phenomenon: `振动在阈值内：最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²，clip 增量 0`,
      impact: "振动未对 IMU 与姿态估计构成威胁",
      evidence,
      metrics: {
        stdX: ind.axes[0].std,
        stdY: ind.axes[1].std,
        stdZ: ind.axes[2].std,
        maxX: ind.axes[0].max,
        maxY: ind.axes[1].max,
        maxZ: ind.axes[2].max,
        clipDelta: ind.clipDelta,
        samples: ind.samples,
      },
      docLinks: [DOC],
      charts: chartsFor(ind),
    });
  }

  const suggestions =
    severity === "critical"
      ? [
          suggestion(1, "先处理机械振动：检查螺旋桨动平衡、桨夹间隙与电机轴承"),
          suggestion(2, "检查飞控减振（减振垫老化/硬化、线束拉扯导致的刚性耦合）"),
          suggestion(3, "机械问题解决后复飞，再依据振动规则与滤波规则的结论调参"),
        ]
      : [
          suggestion(1, "检查螺旋桨动平衡与机架紧固件"),
          suggestion(2, "若振动仍偏高，再考虑调整减振与滤波（按滤波规则给出的顺序）"),
        ];

  return makeFinding({
    ruleId: RULE_ID,
    title: label,
    severity,
    status: "fired",
    window: ind.window,
    phenomenon: failed
      ? `IMU${ind.instance} 加速度计发生饱和：飞行段内 clip 计数增加 ${ind.clipDelta}；最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²`
      : `IMU${ind.instance} 振动水平偏高：最差轴 ${ind.worstAxis.toUpperCase()} 标准差 ${ind.worstStd.toFixed(2)} m/s²（阈值 ${VIBRATION.stdWarning}）`,
    impact: failed
      ? "加速度计饱和会直接污染姿态估计与振动补偿，可能诱发 EKF 失效与姿态抖动"
      : "持续振动会加速 IMU 漂移、降低姿态估计精度，长期还会加剧舵机与机架疲劳",
    evidence,
    metrics: {
      stdX: ind.axes[0].std,
      stdY: ind.axes[1].std,
      stdZ: ind.axes[2].std,
      maxX: ind.axes[0].max,
      maxY: ind.axes[1].max,
      maxZ: ind.axes[2].max,
      clipDelta: ind.clipDelta,
      samples: ind.samples,
    },
    suggestions,
    docLinks: [DOC],
    charts: chartsFor(ind),
  });
}

export const vibrationRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "vibration",
  appliesTo: [
    {
      platform: "ardupilot",
      requires: ["VIBE"],
      note: "ArduPilot 各机型均记录 VIBE；旧固件（<3.4）可能没有",
    },
  ],
  run(ctx) {
    const scan = scanVibration(ctx);
    if (scan.unavailable) {
      return [
        unknownFinding({
          ruleId: RULE_ID,
          title: TITLE,
          status: "insufficient_data",
          note: scan.unavailable,
        }),
      ];
    }
    const imuCount = scan.indicators.length;
    return scan.indicators.map((ind) => buildFinding(ind, imuCount));
  },
};

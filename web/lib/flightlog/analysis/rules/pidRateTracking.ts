/**
 * 规则 2：速率环跟踪质量（分轴）
 *
 * ⚠️ 与方案 v2 的差异（实测否决，依据见 docs/日志诊断-接口契约.md §1.5）：
 *   方案要求"对 TARG 与实际值做差 → FFT 找主峰，峰频 <10 Hz 且功率超阈值即判振荡"。
 *   实测否决两处：
 *     ① **Nyquist 不够**：ArduPilot 的 PID 消息默认只有 10 Hz（实测 6 份日志均为 10 Hz，
 *        固定翼 25 Hz）→ 只能观测 <5 Hz。方案举例的 6.2 Hz 主峰在 PID 日志里**测不到**。
 *     ② **阈值不可分**：0.8–4 Hz 频带能量占比在健康与故障日志间完全重叠（0.027–0.572），
 *        任何固定频谱阈值都会误报。
 *   因此本规则不做频谱定阈判定，改用可判定的时域跟踪质量（Err/Tar），
 *   并如实声明频率域的能力边界与补齐方法。
 *
 * 另一个实测教训：悬停飞行时指令角速度极小（quad 实测 roll Tar RMS 仅 3.2 deg/s），
 * 此时 Err/Tar 天然 > 1。若不设激励门槛，会对**健康日志误报**——这是必须避免的失败模式。
 */

import type { ChartRequest, Finding } from "../../types/report";
import type { Rule, RuleContext } from "../../types/rule";
import type { TimeWindow } from "../../types/log";
import { makeFinding, suggestion, unknownFinding } from "../finding";
import { longestWindow } from "../windows";
import {
  computeRateAxisEvidence,
  spectrumCapabilityNote,
  type RateAxisEvidence,
  type RateAxisSpec,
} from "../rateAxisEvidence";
import { PID_RATE } from "../thresholds";

const RULE_ID = "pid_rate_tracking";
const TITLE = "速率环跟踪质量";
const DOC = "https://ardupilot.org/copter/docs/tuning-process-instructions.html";

const PARAM_MAP = {
  rollRateP: "ATC_RAT_RLL_P",
  pitchRateP: "ATC_RAT_PIT_P",
  yawRateP: "ATC_RAT_YAW_P",
} as const;

const AXES: readonly RateAxisSpec[] = [
  { axis: "roll", message: "PIDR", label: "Roll", paramName: PARAM_MAP.rollRateP },
  { axis: "pitch", message: "PIDP", label: "Pitch", paramName: PARAM_MAP.pitchRateP },
  { axis: "yaw", message: "PIDY", label: "Yaw", paramName: PARAM_MAP.yawRateP },
];

function chartsFor(spec: RateAxisSpec, window: TimeWindow): ChartRequest[] {
  return [
    {
      id: `${RULE_ID}-${spec.axis}`,
      kind: "timeseries",
      title: `${spec.label} 速率环：指令 / 实际 / 误差`,
      signals: [
        { series: spec.message, field: "Tar", label: "指令 Tar" },
        { series: spec.message, field: "Act", label: "实际 Act" },
        { series: spec.message, field: "Err", label: "误差 Err" },
      ],
      window,
      thresholds: [],
      peakMarkers: [],
      highlightWindow: null,
      spectrum: null,
    },
  ];
}

function buildAxisFinding(
  ev: RateAxisEvidence,
  capNote: string | null,
  currentP: number | null,
): Finding {
  const title = `${TITLE}（${ev.spec.label}）`;
  const charts = chartsFor(ev.spec, ev.window);
  const common = {
    ruleId: RULE_ID,
    title,
    axis: ev.spec.axis,
    window: ev.window,
    evidence: ev.evidence,
    metrics: ev.metrics,
    docLinks: [DOC],
    charts,
    note: capNote,
  };

  if (!ev.excited) {
    return makeFinding({
      ...common,
      severity: "unknown",
      status: "insufficient_data",
      phenomenon: `本次飞行 ${ev.spec.label} 轴指令过小：Tar RMS 仅 ${ev.tarRmsDegPerSec.toFixed(2)} deg/s（门槛 ${PID_RATE.minExcitationDegPerSec} deg/s），无法评价跟踪质量`,
      impact: "无法判断该轴跟踪是否正常，不代表通过",
      note: `指令激励 ${ev.tarRmsDegPerSec.toFixed(2)} deg/s 低于评估门槛 ${PID_RATE.minExcitationDegPerSec} deg/s：激励不足时 Err/Tar 天然可大于 1，因此不做判定，结果不代表通过。${capNote ?? ""}`.trim(),
    });
  }

  const severity =
    ev.ratio >= PID_RATE.errRatioCritical
      ? "critical"
      : ev.ratio >= PID_RATE.errRatioWarning
        ? "warning"
        : "ok";

  if (severity === "ok") {
    return makeFinding({
      ...common,
      severity: "ok",
      status: "passed",
      phenomenon: `${ev.spec.label} 轴跟踪良好：Err/Tar = ${ev.ratio.toFixed(3)}（指令 RMS ${ev.tarRmsDegPerSec.toFixed(2)} deg/s）`,
      impact: "速率环能够跟随指令，不构成姿态控制风险",
    });
  }

  const extraNote =
    severity === "critical" && ev.sampleRateHz !== null && ev.sampleRateHz < 20
      ? `高增益振荡通常表现为高频抖动，本次记录率不足以致命；若怀疑高频振荡请开启 INS_LOG_BAT_MASK=1 后复飞。${capNote ?? ""}`.trim()
      : capNote;

  return makeFinding({
    ...common,
    note: extraNote,
    severity,
    status: "fired",
    phenomenon: `${ev.spec.label} 轴跟踪偏差偏大：Err/Tar = ${ev.ratio.toFixed(3)}（Err RMS ${ev.errRms.toFixed(4)} ${ev.unit}，指令 RMS ${ev.tarRmsDegPerSec.toFixed(2)} deg/s）`,
    impact:
      "跟踪偏差会直接表现为姿态抖动与定位精度下降，并随参数与机械状态恶化而放大",
    suggestions: [
      suggestion(1, "确认滤波配置（按滤波规则给出的顺序，前一步未验证不做后一步）"),
      suggestion(
        2,
        `降低 ${ev.spec.label} 轴速率环 P（保守从 -20% 起步），复飞后再按误差 RMS 变化继续调整`,
        {
          param: {
            name: ev.spec.paramName,
            from: currentP,
            to: currentP !== null ? currentP * 0.8 : 0,
            reason: "跟踪误差偏大时优先降低 P；若降 P 后误差反而增大，再考虑 D/FF",
          },
          verify: `${ev.spec.label} 轴 rate error RMS 下降 ≥30%`,
        },
      ),
      suggestion(3, "若仍不跟踪，检查重心 / 推力不对称（I 项饱和方向）与舵面、电机一致性"),
    ],
  });
}

export const pidRateTrackingRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "pid",
  appliesTo: [
    {
      platform: "ardupilot",
      minVersion: 30400,
      requires: ["PIDR", "PIDP", "PIDY"],
      paramMap: PARAM_MAP,
      note: "PIDx 逐项日志（含 Tar/Act/Err）自 3.4 起稳定；4.1+ 的 P 参数名为 ATC_RAT_*_P",
    },
  ],
  run(ctx: RuleContext) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [
        unknownFinding({
          ruleId: RULE_ID,
          title: TITLE,
          status: "insufficient_data",
          note: "没有可用的飞行（arm）时间段，无法评估速率环跟踪质量",
        }),
      ];
    }
    const capNote = spectrumCapabilityNote(ctx);
    return AXES.map((spec) => {
      const ev = computeRateAxisEvidence(ctx, spec, window);
      if ("kind" in ev) {
        return unknownFinding({
          ruleId: RULE_ID,
          title: `${TITLE}（${spec.label}）`,
          status: ev.kind === "missing" ? "missing_required" : "insufficient_data",
          note: ev.detail,
        });
      }
      return buildAxisFinding(ev, capNote, ctx.param(spec.paramName));
    });
  },
};

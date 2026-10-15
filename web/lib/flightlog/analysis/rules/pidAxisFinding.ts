/**
 * 速率环分轴结论的构造（从 `pidRateTracking.ts` 拆出：原文件超过 200 行上限）。
 *
 * 这里只负责"把一份 RateAxisEvidence 变成 Finding"，不含适用性判断——
 * 适用性（固定翼没有 yaw 速率环之类）留在规则文件里。
 */

import type { ChartRequest, Finding } from "../../types/report";
import type { TimeWindow } from "../../types/log";
import { makeFinding, suggestion } from "../finding";
import { PID_RATE } from "../thresholds";
import type { RateAxisEvidence, RateAxisSpec } from "../rateAxisEvidence";

export const PID_RULE_ID = "pid_rate_tracking";
export const PID_RULE_TITLE = "速率环跟踪质量";
export const PID_DOC =
  "https://ardupilot.org/copter/docs/tuning-process-instructions.html";

export function pidChartsFor(spec: RateAxisSpec, window: TimeWindow): ChartRequest[] {
  return [
    {
      id: `${PID_RULE_ID}-${spec.axis}`,
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

export function buildAxisFinding(
  ev: RateAxisEvidence,
  capNote: string | null,
  currentP: number | null,
): Finding {
  const common = {
    ruleId: PID_RULE_ID,
    title: `${PID_RULE_TITLE}（${ev.spec.label}）`,
    axis: ev.spec.axis,
    window: ev.window,
    evidence: ev.evidence,
    metrics: ev.metrics,
    docLinks: [PID_DOC],
    charts: pidChartsFor(ev.spec, ev.window),
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

  const note =
    severity === "critical" && ev.sampleRateHz !== null && ev.sampleRateHz < 20
      ? `高增益振荡通常表现为高频抖动，本次记录率不足以致命；若怀疑高频振荡请开启 INS_LOG_BAT_MASK=1 后复飞。${capNote ?? ""}`.trim()
      : capNote;

  return makeFinding({
    ...common,
    note,
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

/**
 * 规则 3：滤波有效性 / 陷波配置
 *
 * 交叉验证设计（对应方案「单一异常不轻易下结论」）：
 *   ① 振动指标（VIBE）——机架是否需要陷波；
 *   ② 飞控自身 FFT 结论（FTN1 的 Sn、Ft 字段）——机上是否检出窄峰；
 *   ③ 陷波参数（INS_HNTCH_*）——配置是否与结论一致。
 * 只有 ① 成立时给"先解决机械问题"的建议，**不推参数**；三者一致才谈陷波设置。
 *
 * 实测事实（6 份样本日志）：INS_HNTCH_ENABLE 与 INS_LOG_BAT_MASK 全为 0，
 * FTN1 的 Sn 均 ≤ 0 dB（低于 FFT_SNR_REF=25）→ 机上未检出显著窄峰。
 * 因此真实日志上的主要产出是"振动超标但陷波未启用"与"频谱能力边界"两类结论。
 */

import type { ChartRequest, Finding } from "../../types/report";
import type { Rule, RuleContext } from "../../types/rule";
import { makeFinding, step } from "../finding";
import { longestWindow } from "../windows";
import { scanVibration } from "../vibrationIndicators";
import {
  buildSpectrumChart,
  capabilityNote,
  imuSampleRate,
  readFtn1,
  readNotchConfig,
} from "../notchEvidence";
import {
  configText,
  decideNotch,
  verdictFor,
  type NotchEvidence,
} from "../notchVerdicts";
import { FILTER } from "../thresholds";

const RULE_ID = "filter_notch";
const TITLE = "滤波有效性（陷波配置）";
const DOC = "https://ardupilot.org/copter/docs/common-imu-notch-filtering.html";
const DOC_FFT = "https://ardupilot.org/copter/docs/common-imu-fft.html";

function evidenceSteps(ev: NotchEvidence): ReturnType<typeof step>[] {
  const cfg = ev.cfg;
  const ftnText = ev.ftn
    ? `FTN1 最大 SNR = ${ev.ftn.snrDb.map((v) => v.toFixed(1)).join(" / ")} dB（参考值 ${cfg.snrRef} dB）；报告峰频 ${ev.ftn.peakHz.map((v) => v.toFixed(1)).join(" / ")} Hz`
    : cfg.fftEnabled
      ? "日志中没有 FTN1 消息（需 INS_LOG_BAT_MASK=1 才会记录谐波数据）"
      : "FFT_ENABLE=0，飞控未运行机上 FFT";
  return [
    step("陷波配置", configText(cfg)),
    step("飞控自身 FFT", ftnText),
    step(
      "振动交叉验证",
      ev.vibrationUnavailable
        ? ev.vibrationUnavailable
        : `最差轴标准差 ${ev.worstStd.toFixed(2)} m/s²（"需要陷波"门槛 ${FILTER.vibrationNeedsNotchStd}），各 IMU clip 增量 ${ev.indicators.map((i) => i.clipDelta).join(" / ")}`,
    ),
    step("能力边界", capabilityNote(ev.imuFs)),
    step(
      "参数建议口径",
      "陷波频率必须来自机上实测频谱，不凭经验填写；ATT 超过 20 dB 会削减相位裕度并可能诱发振荡",
    ),
  ];
}

function buildFinding(
  ev: NotchEvidence,
  charts: ChartRequest[],
  window: ReturnType<typeof longestWindow>,
): Finding {
  const verdict = verdictFor(decideNotch(ev), ev);
  return makeFinding({
    ruleId: RULE_ID,
    title: TITLE,
    severity: verdict.severity,
    status:
      verdict.severity === "ok"
        ? "passed"
        : verdict.severity === "unknown"
          ? "checked_but_not_supported"
          : "fired",
    window,
    phenomenon: verdict.phenomenon,
    impact: verdict.impact,
    evidence: evidenceSteps(ev),
    metrics: {
      notchEnabled: ev.cfg.enabled ? 1 : 0,
      notchFreqHz: ev.cfg.freq ?? 0,
      notchAttDb: ev.cfg.att ?? 0,
      fftEnabled: ev.cfg.fftEnabled ? 1 : 0,
      ftnMaxSnrDb:
        ev.ftn && ev.ftn.snrDb.length > 0 ? Math.max(...ev.ftn.snrDb) : -999,
      vibrationWorstStd: ev.worstStd,
      sampleRateHz: ev.imuFs ?? 0,
    },
    suggestions: verdict.suggestions,
    docLinks: [DOC, DOC_FFT],
    charts,
    note: capabilityNote(ev.imuFs),
  });
}

export const filterNotchRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "filter",
  appliesTo: [
    {
      platform: "ardupilot",
      minVersion: 40100,
      requires: [],
      optional: ["FTN1", "FTN2", "VIBE", "IMU"],
      note:
        "谐波陷波自 ArduPilot 4.1 起为 INS_HNTCH_*（旧版为 INS_NOTCH_*）；FFT 结论需 INS_LOG_BAT_MASK=1",
    },
  ],
  run(ctx: RuleContext) {
    const window = longestWindow(ctx.armedWindows());
    const scan = scanVibration(ctx);
    const ev: NotchEvidence = {
      cfg: readNotchConfig(ctx),
      ftn: readFtn1(ctx),
      indicators: scan.indicators,
      vibrationUnavailable: scan.unavailable,
      worstStd: scan.indicators.reduce((m, i) => Math.max(m, i.worstStd), 0),
      imuFs: imuSampleRate(ctx, window),
    };
    const chart = buildSpectrumChart(ctx, ev.cfg.freq);
    return [buildFinding(ev, chart ? [chart] : [], window)];
  },
};

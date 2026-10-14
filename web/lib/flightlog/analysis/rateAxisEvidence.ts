/**
 * 单个速率轴的取证：统计量、单位换算、可审计证据、能力边界声明。
 *
 * 单位陷阱（必须保留此说明）：PIDx.Tar/Act/Err 是控制器**原生单位**，
 * Copter/Sub 为 rad/s、Plane/Rover 为 deg/s，相差 57 倍，
 * 因此所有跨机型可比的判据都必须先乘 RATE_UNIT_TO_DEG_PER_SEC。
 */

import type { EvidenceStep } from "../types/report";
import type { RuleContext, SeriesWindow } from "../types/rule";
import type { TimeWindow } from "../types/log";
import { describeWindow, step } from "./finding";
import { medianSampleInterval, vehicleRateScale } from "./context";
import { absMax, rms } from "./stats";
import { PID_RATE } from "./thresholds";

export interface RateAxisSpec {
  axis: "roll" | "pitch" | "yaw";
  message: string;
  label: string;
  /** 该轴速率环 P 参数名（用于建议） */
  paramName: string;
}

export interface RateAxisEvidence {
  spec: RateAxisSpec;
  window: TimeWindow;
  unit: string;
  unitScale: number;
  tarRms: number;
  errRms: number;
  ratio: number;
  tarRmsDegPerSec: number;
  maxAbsErr: number;
  samples: number;
  sampleRateHz: number | null;
  /** 指令激励是否足以评估跟踪质量 */
  excited: boolean;
  evidence: EvidenceStep[];
  metrics: Record<string, number>;
}

export type AxisUnavailable = { kind: "missing" | "tooFew"; detail: string };

function nativeUnit(ctx: RuleContext, message: string): string {
  const s = ctx.series(message);
  return (
    s?.units["Tar"] ?? (vehicleRateScale(ctx.doc) === 1 ? "deg/s" : "rad/s")
  );
}

export function computeRateAxisEvidence(
  ctx: RuleContext,
  spec: RateAxisSpec,
  window: TimeWindow,
): RateAxisEvidence | AxisUnavailable {
  const series = ctx.series(spec.message);
  const tar: SeriesWindow | null = series
    ? ctx.windowed(spec.message, "Tar", window)
    : null;
  const err: SeriesWindow | null = series
    ? ctx.windowed(spec.message, "Err", window)
    : null;
  if (!series) {
    return { kind: "missing", detail: `日志中没有 ${spec.message} 消息` };
  }
  if (!tar || !err || err.values.length < PID_RATE.minSamples) {
    return {
      kind: "tooFew",
      detail: `飞行段内 ${spec.message} 样本不足（${err?.values.length ?? 0} 条，门槛 ${PID_RATE.minSamples}）`,
    };
  }

  const unitScale = vehicleRateScale(ctx.doc);
  const unit = nativeUnit(ctx, spec.message);
  const tarRms = rms(tar.values);
  const errRms = rms(err.values);
  const tarRmsDegPerSec = tarRms * unitScale;
  const ratio = tarRms > 1e-9 ? errRms / tarRms : Number.POSITIVE_INFINITY;
  const dt = medianSampleInterval(series, window);
  const sampleRateHz = dt ? 1 / dt : null;
  const samples = err.values.length;
  const excited = tarRmsDegPerSec >= PID_RATE.minExcitationDegPerSec;

  const evidence: EvidenceStep[] = [
    step(
      "统计区间",
      `${describeWindow(window)}，样本 ${samples} 条${sampleRateHz ? `，记录率约 ${sampleRateHz.toFixed(1)} Hz` : ""}`,
    ),
    step(
      "原生命中量",
      `${spec.message}：Tar RMS ${tarRms.toFixed(4)} ${unit}，Err RMS ${errRms.toFixed(4)} ${unit}，Err 峰值 ${absMax(err.values).toFixed(4)} ${unit}`,
    ),
    step(
      "单位换算",
      `按机型约定 ${spec.label} 轴速率原生单位为 ${unit}，换算系数 ${unitScale.toFixed(3)} → Tar RMS ${tarRmsDegPerSec.toFixed(2)} deg/s`,
    ),
    step(
      "判据",
      `指令激励门槛 ${PID_RATE.minExcitationDegPerSec} deg/s；Err/Tar 比 ${Number.isFinite(ratio) ? ratio.toFixed(3) : "∞"}（警告 ${PID_RATE.errRatioWarning} / 严重 ${PID_RATE.errRatioCritical}）`,
    ),
    step(
      "为什么不做频谱定阈",
      "实测 6 份日志中健康与故障日志的 0.8–4 Hz 频带能量占比完全重叠（0.027–0.572），固定频谱阈值必然误报；频率域结论需依赖飞控自身 FFT（FTN1/FTN2）并在开启 INS_LOG_BAT_MASK 后判读",
    ),
  ];

  return {
    spec,
    window,
    unit,
    unitScale,
    tarRms,
    errRms,
    ratio,
    tarRmsDegPerSec,
    maxAbsErr: absMax(err.values),
    samples,
    sampleRateHz,
    excited,
    evidence,
    metrics: {
      tarRms,
      errRms,
      errRatio: Number.isFinite(ratio) ? ratio : -1,
      tarRmsDegPerSec,
      maxAbsErr: absMax(err.values),
      samples,
      sampleRateHz: sampleRateHz ?? 0,
    },
  };
}

/** 频率域能力边界；记录率足够时返回 null */
export function spectrumCapabilityNote(ctx: RuleContext): string | null {
  const dt = medianSampleInterval(ctx.series("PIDR"));
  if (dt === null) return null;
  const fs = 1 / dt;
  if (fs >= 20) return null;
  return `PID 消息以 ${fs.toFixed(1)} Hz 记录，频率域只能观测低于 ${(fs / 2).toFixed(1)} Hz 的振荡；电机/结构共振（通常 50–300 Hz）需设 INS_LOG_BAT_MASK=1 采集谐波数据后另行分析`;
}

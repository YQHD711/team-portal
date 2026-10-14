/**
 * 陷波/滤波诊断的**取证层**：读取配置、飞控自身 FFT 结论、能力边界与频谱图。
 * 与规则判定分离，便于单独测试与复用（后续 PX4 规则也可取用）。
 */

import type { ChartRequest, SpectrumPoint } from "../types/report";
import type { RuleContext, SeriesWindow } from "../types/rule";
import type { TimeWindow } from "../types/log";
import { medianSampleInterval } from "./context";
import { longestWindow } from "./windows";
import { computeSpectrum } from "./spectrum";
import { FILTER } from "./thresholds";

export interface NotchConfig {
  enabled: boolean;
  freq: number | null;
  bw: number | null;
  att: number | null;
  mode: number | null;
  hmNcs: number | null;
  fftEnabled: boolean;
  batchLogMask: number | null;
  snrRef: number;
}

export function readNotchConfig(ctx: RuleContext): NotchConfig {
  return {
    enabled: (ctx.param("INS_HNTCH_ENABLE") ?? 0) >= 1,
    freq: ctx.param("INS_HNTCH_FREQ"),
    bw: ctx.param("INS_HNTCH_BW"),
    att: ctx.param("INS_HNTCH_ATT"),
    mode: ctx.param("INS_HNTCH_MODE"),
    hmNcs: ctx.param("INS_HNTCH_HMNCS"),
    fftEnabled: (ctx.param("FFT_ENABLE") ?? 0) >= 1,
    batchLogMask: ctx.param("INS_LOG_BAT_MASK"),
    snrRef: ctx.param("FFT_SNR_REF") ?? FILTER.ftnSnrReferenceDb,
  };
}

export interface FtnSummary {
  /** 三个轴的最大 SNR（dB） */
  snrDb: number[];
  /** 三个轴的报告峰频（Hz） */
  peakHz: number[];
  pkAvg: number | null;
  bwAvg: number | null;
}

export function readFtn1(ctx: RuleContext): FtnSummary | null {
  const s = ctx.series("FTN1");
  if (!s || s.timeSec.length === 0) return null;
  const maxOf = (field: string): number | null => {
    const v = s.fields[field];
    if (!v || v.length === 0) return null;
    let max = -Infinity;
    for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
    return Number.isFinite(max) ? max : null;
  };
  const lastOf = (field: string): number | null => {
    const v = s.fields[field];
    return v && v.length > 0 ? v[v.length - 1] : null;
  };
  const snrDb: number[] = [];
  const peakHz: number[] = [];
  for (const field of ["SnX", "SnY", "SnZ"]) {
    const v = maxOf(field);
    if (v !== null) snrDb.push(v);
  }
  for (const field of ["FtX", "FtY", "FtZ"]) {
    const v = maxOf(field);
    if (v !== null) peakHz.push(v);
  }
  return { snrDb, peakHz, pkAvg: lastOf("PkAvg"), bwAvg: lastOf("BwAvg") };
}

export function imuSampleRate(
  ctx: RuleContext,
  window: TimeWindow | null,
): number | null {
  const dt = medianSampleInterval(ctx.series("IMU"), window ?? undefined);
  return dt ? 1 / dt : null;
}

/**
 * 能力边界必须逐条写进报告：不写清楚"看不到什么"，
 * 用户会把"没检出问题"误读成"没有问题"。
 */
export function capabilityNote(fs: number | null): string {
  if (fs === null) {
    return "本日志未记录 IMU 数据，无法做频域分析";
  }
  return `本日志 IMU 记录率约 ${fs.toFixed(1)} Hz，频谱只能覆盖低于 ${(fs / 2).toFixed(1)} Hz；电机与结构共振（通常 50–300 Hz）不可见，需设 INS_LOG_BAT_MASK=1 采集谐波数据后由飞控自身 FFT（FTN1/FTN2）判定`;
}

/**
 * IMU 原始加速度的低频频谱图。记录率过低时依然给出图，
 * 但 note 会说明可见范围，避免"图很干净"被误读。
 */
export function buildSpectrumChart(
  ctx: RuleContext,
  notchFreq: number | null,
): ChartRequest | null {
  const window = longestWindow(ctx.armedWindows());
  if (!window) return null;
  const series = ctx.series("IMU", 0);
  if (!series) return null;
  const w: SeriesWindow | null = ctx.windowed("IMU", "AccZ", window, 0);
  if (!w || w.values.length < 512) return null;
  const fs = imuSampleRate(ctx, window);
  if (!fs || fs < 8) return null;

  const maxHz = Math.min(40, fs * 0.45);
  const spectrum = computeSpectrum(w.timeSec, w.values, {
    minHz: 0.5,
    maxHz,
    maxSamples: 8192,
  });
  if (!spectrum) return null;

  const binHz = spectrum.binHz > 0 ? spectrum.binHz : fs / spectrum.power.length;
  const limit = Math.min(
    spectrum.power.length,
    Math.max(2, Math.floor(maxHz / binHz) + 1),
  );
  const points: SpectrumPoint[] = [];
  for (let i = 1; i < limit; i++) {
    points.push({ freqHz: i * binHz, power: spectrum.power[i] });
  }
  return {
    id: "filter_notch-spectrum",
    kind: "spectrum",
    title: `IMU0 垂直加速度频谱（记录率 ${fs.toFixed(1)} Hz，仅可见 <${(fs / 2).toFixed(1)} Hz）`,
    signals: [{ series: "IMU", field: "AccZ", instance: 0, label: "AccZ" }],
    window,
    thresholds: [],
    peakMarkers:
      notchFreq !== null && notchFreq > 0
        ? [{ freqHz: notchFreq, label: `陷波中心 ${notchFreq} Hz` }]
        : [],
    highlightWindow: null,
    spectrum: {
      ref: { series: "IMU", field: "AccZ", instance: 0 },
      points,
      peakHz: spectrum.peakHz,
    },
  };
}

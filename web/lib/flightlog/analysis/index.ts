/**
 * 诊断引擎对外入口（纯函数，不依赖浏览器 API，可在 vitest / Worker 里直接调用）。
 */

export { analyzeLog, sortFindings, summarize, hasMessage } from "./engine";
export type { AnalyzeOptions } from "./engine";
export { createRuleContext, seriesInstances, vehicleRateScale } from "./context";
export { detectArmedWindows, spanOf, longestWindow } from "./windows";
export type { ArmedWindowResult } from "./windows";
export { computeSpectrum, resampleUniform } from "./spectrum";
export type { Spectrum, SpectrumOptions } from "./spectrum";
export {
  scanVibration,
} from "./vibrationIndicators";
export type {
  VibrationIndicator,
  VibrationAxisStat,
  VibrationScan,
} from "./vibrationIndicators";
export * as thresholds from "./thresholds";
export { ALL_RULES } from "./rules";

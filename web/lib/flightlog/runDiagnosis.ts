/**
 * 诊断入口 —— UI 只依赖本模块，不直接接触解析器与规则引擎。
 *
 * 签名在 Phase 1 已冻结；实现由 Lead 在集成阶段接上
 * （dataflash 解析 → 规则引擎 → DiagnosisReport）。
 */

import type { DiagnosisReport } from "./types/report";

export type DiagnosisPhase = "parsing" | "analyzing" | "done";

export interface DiagnosisProgress {
  phase: DiagnosisPhase;
  /** 0..100 */
  percent: number;
  /** 可直接展示的中文进度说明 */
  message: string;
}

export interface DiagnosisResult {
  report: DiagnosisReport;
}

export interface RunDiagnosisOptions {
  onProgress?: (progress: DiagnosisProgress) => void;
  /** 取消后续步骤（AbortSignal 语义），解析中止时 reject */
  signal?: AbortSignal;
}

export type RunDiagnosis = (
  file: File,
  options?: RunDiagnosisOptions,
) => Promise<DiagnosisResult>;

/**
 * Phase 1 垂直切片：接入中。
 * 未接线前必须抛出可识别错误，UI 负责展示，不允许静默失败。
 */
export const runDiagnosis: RunDiagnosis = async () => {
  throw new Error(
    "日志诊断尚未接线：解析器与规则引擎正在接入（feat/flightlog-diagnosis）",
  );
};

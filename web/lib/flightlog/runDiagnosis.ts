/**
 * 诊断入口 —— UI 只依赖本模块，不直接接触解析器与规则引擎。
 *
 * 流程：DataFlash 解析（Worker）→ 规则引擎（纯函数）→ DiagnosisReport。
 * 契约说明：`document` 必须一并回传——规则只通过 `ChartRequest` 声明"该看哪几条曲线"，
 * 而曲线的原始采样只能从 LogDocument 取；谱图例外（点已算好放在 `ChartRequest.spectrum`）。
 */

import { analyzeLog } from "./analysis";
import { parseLogFile } from "./dataflash";
import type { LogDocument } from "./types/log";
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
  /** 原始信号（时序图取数用） */
  document: LogDocument;
}

export interface RunDiagnosisOptions {
  onProgress?: (progress: DiagnosisProgress) => void;
  signal?: AbortSignal;
}

export type RunDiagnosis = (
  file: File,
  options?: RunDiagnosisOptions,
) => Promise<DiagnosisResult>;

/** 本切片只实现 ArduPilot 二进制日志；其余格式给出明确说明而不是晦涩的解析错误 */
const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  ".ulg": "PX4 ULog（.ulg）解析器尚未实现（架构位已保留）",
  ".log": "ArduPilot 文本日志（.log）尚未实现，请提供同一次飞行的 .bin",
  ".tlog": "遥测日志（.tlog）不含飞控内部数据，无法做诊断",
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function ensureSupported(fileName: string): void {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  const reason = UNSUPPORTED_EXTENSIONS[ext];
  if (reason) throw new Error(`暂不支持该格式：${reason}`);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("诊断已取消");
}

export const runDiagnosis: RunDiagnosis = async (file, options = {}) => {
  const { onProgress, signal } = options;
  ensureSupported(file.name);
  throwIfAborted(signal);

  onProgress?.({ phase: "parsing", percent: 0, message: "读取日志字节…" });
  const parseStart = nowMs();
  const document = await parseLogFile(file, {
    signal,
    // jsdom / 无 Worker 环境退化为主线程，避免测试里挂在等待 Worker 上
    forceMainThread: typeof Worker === "undefined",
    onProgress: (p) =>
      onProgress?.({
        phase: "parsing",
        // 解析占 0~90%，规则分析占 90~100%
        percent: Math.max(0, Math.min(90, Math.round(p.percent * 0.9))),
        message: p.message,
      }),
  });
  const parseMs = nowMs() - parseStart;
  throwIfAborted(signal);

  onProgress?.({ phase: "analyzing", percent: 92, message: "运行诊断规则…" });
  const analyzeStart = nowMs();
  const report = analyzeLog(document, {
    fileName: file.name,
    sizeBytes: file.size,
    parseMs,
  });
  const analyzeMs = nowMs() - analyzeStart;

  const summary = report.summary;
  onProgress?.({
    phase: "done",
    percent: 100,
    message: `完成：${summary.critical} 项严重 / ${summary.warning} 项警告 / ${summary.unknown} 项无法判断`,
  });

  return { report: { ...report, parseMs, analyzeMs }, document };
};

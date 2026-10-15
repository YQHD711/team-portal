/**
 * 诊断入口 —— UI 只依赖本模块，不直接接触解析器与规则引擎。
 *
 * 流程：DataFlash 解析（Worker）→ 规则引擎（纯函数）→ DiagnosisReport。
 * 契约说明：`document` 必须一并回传——规则只通过 `ChartRequest` 声明"该看哪几条曲线"，
 * 而曲线的原始采样只能从 LogDocument 取；谱图例外（点已算好放在 `ChartRequest.spectrum`）。
 */

import { analyzeLog } from "./analysis";
import { parseLogFile } from "./dataflash";
import { parseUlogFile } from "./ulog";
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
  /**
   * 解析诊断数据：用于「解析日志」面板与诊断历史落库。
   * 这些数字直接来自解析器（不是二手推断）——排查"解析不完整/跳字节"看的就是它们。
   */
  parseStats: DiagnosisParseStats;
}

export interface DiagnosisParseStats {
  /** 成功解码的记录数 */
  records: number;
  /** 跳过的字节数（未知签名/坏记录）；> 0 时 UI 必须醒目标注 */
  skippedBytes: number;
  /** 已解码的消息类型数 */
  decodedTypes: number;
  /** 日志中出现的消息类型数 */
  totalTypes: number;
  /** 解析耗时（含读文件，用户实际等待时间） */
  parseMs: number;
  /** 规则分析耗时 */
  analyzeMs: number;
  /** 解析过程中的非致命问题，原样透出给用户 */
  warnings: readonly string[];
}

export interface RunDiagnosisOptions {
  onProgress?: (progress: DiagnosisProgress) => void;
  signal?: AbortSignal;
}

export type RunDiagnosis = (
  file: File,
  options?: RunDiagnosisOptions,
) => Promise<DiagnosisResult>;

/** 明确不支持、但能给出人话原因的格式（不是"解析器抛异常"） */
const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  ".log": "ArduPilot 文本日志（.log）尚未实现，请提供同一次飞行的 .bin",
  ".tlog": "遥测日志（.tlog）不含飞控内部数据，无法做诊断",
};

/** 内容嗅探：文件头前 16 字节（伪扩展名/无扩展名也能正确路由） */
const ULOG_MAGIC: readonly number[] = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];
const DF_HEAD_BYTE1 = 0xa3;
const DF_HEAD_BYTE2 = 0x95;

type LogFormat = "dataflash" | "ulog";

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

export function sniffFormat(head: Uint8Array): LogFormat | null {
  if (head.length >= 7 && ULOG_MAGIC.every((b, i) => head[i] === b)) return "ulog";
  if (head.length >= 4 && (head[0] === DF_HEAD_BYTE1 || head[0] === DF_HEAD_BYTE2)) return "dataflash";
  return null;
}

/**
 * 按内容/扩展名路由 —— ArduPilot `.bin` → DataFlash，PX4 `.ulg` → ULog。
 *
 * 优先级：**内容优先**（同名/改名的文件也能解析），内容嗅探不出来时退回扩展名；
 * 两者都不认识就抛可读原因（**不是**模糊的解析错误）。
 */
async function resolveFormat(file: File): Promise<LogFormat> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffFormat(head);
  if (sniffed) return sniffed;

  const ext = extensionOf(file.name);
  const reason = UNSUPPORTED_EXTENSIONS[ext];
  if (reason) throw new Error(`暂不支持该格式：${reason}`);
  if (ext === ".bin") return "dataflash";
  if (ext === ".ulg") return "ulog";
  throw new Error(
    `无法识别的日志格式（${file.name || "无文件名"}，前 16 字节既不是 DataFlash 的 A3 95 也不是 PX4 ULog 的 "ULog" 魔术头）：`
    + "请提供 ArduPilot 的 .bin 或 PX4 的 .ulg",
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("诊断已取消");
}

export const runDiagnosis: RunDiagnosis = async (file, options = {}) => {
  const { onProgress, signal } = options;
  // 按格式路由（内容优先、扩展名兜底）：未知格式在这里给出可读原因，不落成模糊错误
  const format = await resolveFormat(file);
  throwIfAborted(signal);

  onProgress?.({ phase: "parsing", percent: 0, message: "读取日志字节…" });
  const parseStart = nowMs();
  const parseOptions = {
    signal,
    // jsdom / 无 Worker 环境退化为主线程，避免测试里挂在等待 Worker 上
    forceMainThread: typeof Worker === "undefined",
    onProgress: (p: { percent: number; message: string }) =>
      onProgress?.({
        phase: "parsing",
        // 解析占 0~90%，规则分析占 90~100%
        percent: Math.max(0, Math.min(90, Math.round(p.percent * 0.9))),
        message: p.message,
      }),
  };
  const parsed = format === "ulog"
    ? await parseUlogFile(file, parseOptions)
    : await parseLogFile(file, parseOptions);
  const parseMs = nowMs() - parseStart;
  const document = parsed.doc;
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

  return {
    report: { ...report, parseMs, analyzeMs },
    document,
    parseStats: {
      records: parsed.stats.records,
      skippedBytes: parsed.stats.skippedBytes,
      decodedTypes: Object.keys(document.decodedFields).length,
      totalTypes: Object.keys(document.messageCounts).length,
      parseMs,
      analyzeMs,
      warnings: parsed.warnings,
    },
  };
};

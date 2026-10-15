/**
 * 诊断历史 API（契约见 docs/日志诊断-接口契约.md §0.5.4）。
 *
 * - 走现有 `lib/api.ts` 的 `api`（不直接 fetch、禁 any）；
 * - 只传**摘要**：warnings ≤20 条且每条 ≤500 字、findings 只留 title/severity/status/axis，
 *   **绝不把文档正文或曲线数据传上去**；
 * - 接口可能还没合进 main：调用方必须能扛 404/失败（这里只负责发请求与归一化返回）。
 */

import { api } from "./api";
import type { DiagnosisResult } from "./flightlog/runDiagnosis";
import type { CheckStatus, Severity } from "./flightlog/types/report";
import type { VehicleKind } from "./flightlog/types/log";

export interface FlightDiagnosisFindingSummary {
  ruleId: string;
  title: string;
  severity: Severity;
  status: CheckStatus;
  axis: "roll" | "pitch" | "yaw" | null;
}

/** POST body（契约要求全部字段必填） */
export interface FlightDiagnosisInput {
  fileName: string;
  sizeBytes: number;
  records: number;
  skippedBytes: number;
  durationSec: number;
  vehicle: string;
  vehicleKind: VehicleKind;
  firmwareVersion: string;
  versionNumeric: number;
  parseMs: number;
  analyzeMs: number;
  decodedTypes: number;
  totalTypes: number;
  critical: number;
  warning: number;
  passed: number;
  unknown: number;
  warnings: string[];
  findings: FlightDiagnosisFindingSummary[];
}

export interface FlightDiagnosisRecord extends FlightDiagnosisInput {
  id: number;
  createdBy: string;
  createdAt: string;
}

export interface FlightDiagnosisList {
  total: number;
  items: FlightDiagnosisRecord[];
}

export const WARNINGS_MAX = 20;
export const WARNING_MAX_CHARS = 500;

/** 服务端限制：最多 20 条、每条 ≤500 字（超了截断，别让整条记录被 400 拒掉） */
export function capWarnings(warnings: readonly string[]): string[] {
  return warnings.slice(0, WARNINGS_MAX).map(w =>
    w.length > WARNING_MAX_CHARS ? `${w.slice(0, WARNING_MAX_CHARS)}…` : w,
  );
}

/** 从诊断结果提取落库摘要（不含 document / 曲线 / 文档正文） */
export function buildDiagnosisRecord(result: DiagnosisResult): FlightDiagnosisInput {
  const { report, parseStats } = result;
  const meta = report.meta;
  return {
    fileName: report.fileName,
    sizeBytes: report.sizeBytes,
    records: parseStats.records,
    skippedBytes: parseStats.skippedBytes,
    durationSec: meta.durationSec,
    vehicle: meta.vehicle,
    vehicleKind: meta.vehicleKind,
    firmwareVersion: meta.firmwareVersion,
    versionNumeric: meta.versionNumeric,
    parseMs: parseStats.parseMs,
    analyzeMs: parseStats.analyzeMs,
    decodedTypes: parseStats.decodedTypes,
    totalTypes: parseStats.totalTypes,
    critical: report.summary.critical,
    warning: report.summary.warning,
    passed: report.summary.passed,
    unknown: report.summary.unknown,
    warnings: capWarnings(parseStats.warnings),
    findings: report.findings.map(f => ({
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      status: f.status,
      axis: f.axis,
    })),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** 归一化列表响应：结构不合法（含接口未上线返回 {}）→ 空列表，由 UI 给可读状态 */
export function normalizeDiagnosisList(raw: unknown): FlightDiagnosisList {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { total: 0, items: [] };
  const items = raw.items.filter(isRecord).map(item => ({
    ...(item as unknown as FlightDiagnosisInput),
    id: Number(item.id) || 0,
    createdBy: typeof item.createdBy === "string" ? item.createdBy : "",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
  }));
  return { total: typeof raw.total === "number" ? raw.total : items.length, items };
}

export async function createFlightDiagnosis(
  body: FlightDiagnosisInput,
): Promise<{ id: number; createdAt: string }> {
  return api.post<{ id: number; createdAt: string }>("/api/flight-diagnoses", body);
}

export async function listFlightDiagnoses(
  params: { limit?: number; offset?: number; fileName?: string } = {},
): Promise<FlightDiagnosisList> {
  const q = new URLSearchParams();
  q.set("limit", String(params.limit ?? 20));
  q.set("offset", String(params.offset ?? 0));
  if (params.fileName) q.set("fileName", params.fileName);
  return normalizeDiagnosisList(await api.get<unknown>(`/api/flight-diagnoses?${q}`));
}

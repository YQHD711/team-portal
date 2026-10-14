/**
 * 诊断报告展示用的纯格式化/判定逻辑（无副作用，便于单测）。
 *
 * 最重要的一条：**只有 `status === "passed"` 才能显示「通过」**。
 * not_applicable / checked_but_not_supported / missing_required / insufficient_data
 * 全部属于 unknown 一侧 —— UI 要显示「无法判断/不适用」并给出 note 原因（不允许静默跳过）。
 */

import type { CheckStatus, Severity } from "@/lib/flightlog/types/report";
import type { TimeWindow } from "@/lib/flightlog/types/log";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "warning", "unknown", "ok"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "严重",
  warning: "警告",
  ok: "正常",
  unknown: "无法判断",
};

/** 严重等级配色（卡片左边框 / 徽标） */
export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "border-danger bg-red-50/60 dark:bg-red-950/20",
  warning: "border-warning bg-amber-50/60 dark:bg-amber-950/20",
  unknown: "border-border bg-surface-subtle",
  ok: "border-success bg-emerald-50/40 dark:bg-emerald-950/10",
};

export const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  critical: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  unknown: "bg-surface-hover text-muted",
  ok: "bg-success/15 text-success",
};

/** unknown 一侧的四个状态：**不是**「通过」，必须展示原因 */
export function isUnknownSide(status: CheckStatus): boolean {
  return status === "not_applicable"
    || status === "checked_but_not_supported"
    || status === "missing_required"
    || status === "insufficient_data";
}

export function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "passed": return "通过";
    case "fired": return "已触发";
    case "not_applicable": return "不适用";
    case "checked_but_not_supported": return "机型/版本不支持该检查";
    case "missing_required": return "缺少必需数据";
    case "insufficient_data": return "数据不足，无法判断";
  }
}

/** 状态徽标配色：只有 passed 才用"通过"的绿色 */
export function statusBadgeClass(status: CheckStatus): string {
  if (status === "passed") return "bg-success/15 text-success";
  if (status === "fired") return "bg-danger/15 text-danger";
  return "bg-surface-hover text-muted";   // unknown 一侧：一律中性灰
}

export const AXIS_LABEL: Record<"roll" | "pitch" | "yaw", string> = {
  roll: "横滚", pitch: "俯仰", yaw: "偏航",
};

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${sec.toFixed(1)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 60 ? `${m + 1} 分` : `${m} 分 ${s} 秒`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 时间窗文案；null = 全日志 */
export function windowLabel(w: TimeWindow | null): string {
  if (!w) return "全日志";
  return `${w.startSec.toFixed(2)}s – ${w.endSec.toFixed(2)}s`;
}

/** 从文件名里取日期（`quad_20260617.bin` → `2026-06-17`）；没有可识别日期时 null */
export function dateFromFileName(name: string): string | null {
  const m = /(20\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** metrics 展示：key 排序（稳定），数值按大小保留 3 位有效小数 */
export function metricRows(metrics: Readonly<Record<string, number>>): { key: string; value: string }[] {
  return Object.keys(metrics).sort().map(key => {
    const v = metrics[key];
    if (!Number.isFinite(v)) return { key, value: "—" };
    const abs = Math.abs(v);
    const text = abs >= 1000 ? v.toFixed(0) : abs >= 1 ? v.toFixed(2) : v.toPrecision(3);
    return { key, value: text };
  });
}

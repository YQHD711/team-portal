"use client";

import type { DiagnosisReport } from "@/lib/flightlog/types/report";
import { formatBytes, formatDuration, dateFromFileName } from "./format";

/** 报告抬头：日期 / 机型 / 固件版本 / 时长 / 规则库适配标注 */
export function ReportHeader({ report }: { report: DiagnosisReport }) {
  const date = dateFromFileName(report.fileName);
  const { meta } = report;

  const cells: { label: string; value: string; hint?: string }[] = [
    { label: "日期", value: date ?? "—", hint: date ? undefined : "文件名里没有可识别日期" },
    { label: "机型", value: meta.vehicle || "未知", hint: meta.board },
    { label: "固件版本", value: meta.firmwareVersion || "未知", hint: meta.firmwareString || undefined },
    { label: "日志时长", value: formatDuration(meta.durationSec), hint: meta.armed ? "检测到 arm" : "未检测到 arm" },
  ];

  return (
    <div data-testid="report-header" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{report.fileName}</h3>
        <span className="text-xs text-faint">
          {formatBytes(report.sizeBytes)} · 解析 {(report.parseMs / 1000).toFixed(2)}s · 分析 {(report.analyzeMs / 1000).toFixed(2)}s
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(c => (
          <div key={c.label}>
            <dt className="text-[11px] text-faint">{c.label}</dt>
            <dd className="text-sm font-medium" title={c.hint}>{c.value}</dd>
          </div>
        ))}
      </dl>

      {/* 规则库适配标注：规则是按平台/版本裁决的，必须让用户看到这个前提 */}
      <p data-testid="ruleset-fit" className="mt-3 rounded-lg bg-surface-subtle px-3 py-2 text-[11px] leading-relaxed text-muted">
        规则库适配：{meta.platform === "ardupilot" ? "ArduPilot" : meta.platform === "px4" ? "PX4" : "未知平台"}
        {" · "}{meta.vehicleKind}
        {" · "}{meta.versionNumeric > 0 ? `版本号 ${meta.versionNumeric}` : "版本号未知"}
        {meta.platform === "px4" && "（本切片只覆盖 ArduPilot，PX4 规则未实现）"}
      </p>

      {meta.platform === "ardupilot" && meta.versionNumeric > 0 && meta.versionNumeric < 40400 && (
        <p className="mt-2 rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          当前 {meta.firmwareVersion}：部分规则要求 ArduPilot ≥ 4.4（需要 PIDR 逐项日志），这些规则会显示「不适用」而不是「通过」。
        </p>
      )}
    </div>
  );
}

/**
 * 解析日志面板：让"解析到底发生了什么"可见，便于排查解析失败。
 *
 * 两条硬要求（验收点，不许做成灰色小字）：
 *  - `skippedBytes > 0` → **危险色醒目告警**（有字节被跳过，原因见 warnings；
 *    实测 46/76 个真实日志都会触发，因为**文件末尾半条记录**是常态，所以文案不能一口咬定"损坏"）；
 *  - `decodedTypes < totalTypes` → 明确标注"解析未完整覆盖 N 种消息类型"。
 * 另外 `records === 0` 时不给一堆 0，而是直接给结论。
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import type { DiagnosisParseStats } from "@/lib/flightlog/runDiagnosis";
import { formatBytes } from "./format";

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

export function ParseLogPanel({ stats }: { stats: DiagnosisParseStats }) {
  const [open, setOpen] = useState(false);
  const missingTypes = Math.max(0, stats.totalTypes - stats.decodedTypes);
  const noRecords = stats.records === 0;

  return (
    <section data-testid="parse-log-panel" className="rounded-xl border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <ScrollText className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-semibold">解析日志</h3>
        <span data-testid="parse-timing" className="text-xs text-muted">
          解析 {ms(stats.parseMs)} · 分析 {ms(stats.analyzeMs)}
        </span>
        <span data-testid="parse-records" className="ml-auto font-mono text-xs">
          {stats.records} 条记录
        </span>
      </header>

      {/* records === 0：直接给结论，而不是显示一堆 0 */}
      {noRecords && (
        <p data-testid="parse-records-zero"
          className="mt-3 rounded-lg border-l-4 border-danger bg-red-50 px-3 py-2 text-xs font-medium leading-relaxed text-red-700 dark:bg-red-950/30 dark:text-red-300">
          没解析出任何记录：这段字节很可能不是 DataFlash 日志（或文件被截断/损坏）。请确认导出的是飞控 `.bin`，
          而不是文本日志、遥测日志或其它文件。
        </p>
      )}

      {/* 跳过字节：>0 必须醒目 */}
      {stats.skippedBytes > 0 ? (
        <p data-testid="parse-skipped-warning"
          className="mt-3 flex gap-2 rounded-lg border-l-4 border-danger bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>有 {formatBytes(stats.skippedBytes)}（{stats.skippedBytes} 字节）被跳过</strong>
            ：具体原因见下方「解析警告」。实测最常见的是**文件末尾半条记录**（下载或传输被截断），不影响其余记录；
            若警告里出现未知签名或字段解码失败，才说明日志本身可能损坏。
          </span>
        </p>
      ) : (
        <p data-testid="parse-skipped-none" className="mt-3 text-xs text-success">
          无跳过字节（全部字节都被识别）
        </p>
      )}

      {/* 覆盖度：不相等必须标注 */}
      <p data-testid="parse-coverage" className="mt-2 text-xs text-muted">
        消息类型覆盖：<span className="font-mono">{stats.decodedTypes} / {stats.totalTypes}</span>
      </p>
      {missingTypes > 0 && (
        <p data-testid="parse-coverage-warning"
          className="mt-2 rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <strong>解析未完整覆盖 {missingTypes} 种消息类型</strong>
          ：这些类型只统计了条数、没有解码字段，依赖它们的规则会落在"无法判断"一侧。
        </p>
      )}

      {/* 警告：逐条原文；没有警告时**不渲染空壳** */}
      {stats.warnings.length > 0 && (
        <div className="mt-3">
          <button type="button" data-testid="parse-warnings-toggle" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            解析警告 {stats.warnings.length} 条
          </button>
          {open && (
            <ul data-testid="parse-warnings" className="mt-2 space-y-1">
              {stats.warnings.map((w, i) => (
                <li key={`${i}-${w.slice(0, 12)}`} data-testid="parse-warning-item"
                  className="rounded bg-surface-subtle px-2 py-1 font-mono text-[11px] leading-relaxed break-all">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

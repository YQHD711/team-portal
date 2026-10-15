/**
 * 规则语料标定/回归的公共夹具（非 *.test.ts，不会被 vitest 收集）。
 *
 * 职责：把 76 个真实日志跑一遍两条新规则，收集 **每条结论的指标与状态**，
 * 供测试断言"每个日志都有结论且不抛异常"，并输出**实测分位数**用于阈值标定。
 *
 * ⚠️ 文件读取必须由测试在 `it` 体内触发（这里只提供函数，模块加载不碰语料）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDataflash } from "@/lib/flightlog/dataflash/parseDataflash";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { attitudeTrackingRule } from "@/lib/flightlog/analysis/rules/attitudeTracking";
import { speedPositionTrackingRule } from "@/lib/flightlog/analysis/rules/speedPositionTracking";
import type { Finding } from "@/lib/flightlog/types/report";
import { manifest, type ManifestEntry } from "./flightlog-corpus-fixture";
import { acceptanceOf, type AcceptanceRow } from "./flightlog-corpus-acceptance";

export interface MetricRow {
  file: string;
  vehicle: string;
  ruleId: string;
  subject: string;
  status: Finding["status"];
  severity: Finding["severity"];
  errRms: number;
  maxAbsErr: number;
  targetRms: number;
  excitement: number;
  errRatio: number;
  samples: number;
}

export interface FileRulesReport {
  file: string;
  vehicle: string;
  vehicleKind: string;
  ms: number;
  findings: number;
  byStatus: Record<string, number>;
  rows: MetricRow[];
  problems: string[];
  /** task-32 四条要求的语料实测（在**同一遍解析**里顺便采集，避免再跑一遍 76 个文件） */
  acceptance: AcceptanceRow;
}

const rules = [attitudeTrackingRule, speedPositionTrackingRule];

/** 每条结论必须满足的状态/严重度一致性（unknown 一侧不得出现 ok/passed） */
function consistencyProblems(finding: Finding): string[] {
  const problems: string[] = [];
  const unknownSide = ["not_applicable", "checked_but_not_supported", "missing_required", "insufficient_data"];
  if (finding.status === "passed" && finding.severity !== "ok") {
    problems.push(`${finding.title}：status=passed 但 severity=${finding.severity}`);
  }
  if (finding.severity === "ok" && finding.status !== "passed") {
    problems.push(`${finding.title}：severity=ok 但 status=${finding.status}`);
  }
  if (unknownSide.includes(finding.status)) {
    if (finding.severity !== "unknown") {
      problems.push(`${finding.title}：${finding.status} 的 severity 必须是 unknown（现在 ${finding.severity}）`);
    }
    if (!finding.note || finding.note.trim().length === 0) {
      problems.push(`${finding.title}：${finding.status} 必须带说明（note 不能为空）`);
    }
  }
  if (finding.status === "fired" && finding.suggestions.length === 0) {
    problems.push(`${finding.title}：fired 必须给建议`);
  }
  return problems;
}

function subjectOf(finding: Finding): string {
  const open = finding.title.indexOf("（");
  return open < 0 ? finding.title : finding.title.slice(open + 1, -1);
}

export function collectFile(entry: ManifestEntry, root: string): FileRulesReport {
  const bytes = new Uint8Array(readFileSync(join(root, entry.file)));
  const started = performance.now();
  const parsed = parseDataflash(bytes);
  const ctx = createRuleContext(parsed.doc);
  const byStatus: Record<string, number> = {};
  const rows: MetricRow[] = [];
  const problems: string[] = [];
  let findings = 0;

  for (const rule of rules) {
    let produced: Finding[];
    try {
      produced = rule.run(ctx);
    } catch (error) {
      problems.push(`${rule.id} 抛异常：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (produced.length === 0) problems.push(`${rule.id} 没有产出任何结论（必须至少一条）`);
    for (const finding of produced) {
      findings += 1;
      byStatus[finding.status] = (byStatus[finding.status] ?? 0) + 1;
      problems.push(...consistencyProblems(finding));
      const m = finding.metrics;
      rows.push({
        file: entry.file,
        vehicle: entry.banner.split(" ")[0],
        ruleId: rule.id,
        subject: subjectOf(finding),
        status: finding.status,
        severity: finding.severity,
        errRms: m.errRms ?? m.errRmsM ?? Number.NaN,
        maxAbsErr: m.maxAbsErr ?? m.maxAbsErrM ?? Number.NaN,
        targetRms: m.targetRms ?? Number.NaN,
        excitement: m.excitement ?? m.gateM ?? Number.NaN,
        errRatio: m.errRatio ?? Number.NaN,
        samples: m.samples ?? 0,
      });
    }
  }
  return {
    file: entry.file,
    vehicle: entry.banner.split(" ")[0],
    vehicleKind: parsed.doc.meta.vehicleKind,
    ms: performance.now() - started,
    findings,
    byStatus,
    rows,
    problems,
    acceptance: acceptanceOf(ctx),
  };
}

/**
 * 逐文件跑规则并收集指标。
 *
 * ⚠️ 必须**让出事件循环**：76 个文件同步解析要 30–60 s，会把 vitest worker 的 RPC 心跳卡到超时
 * （实测报 `[vitest-worker]: Timeout calling "onTaskUpdate"`，导致整轮 exit 1）。
 * 每处理 `yieldEvery` 个文件 yield 一次控件，测试侧改成 await 即可。
 */
export async function collectAll(root: string, yieldEvery = 1): Promise<FileRulesReport[]> {
  const reports: FileRulesReport[] = [];
  for (let i = 0; i < manifest.files.length; i += 1) {
    reports.push(collectFile(manifest.files[i], root));
    if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return reports;
}


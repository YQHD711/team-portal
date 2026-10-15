/**
 * 两条外环规则（角度环 / 速度位置环）在**真实语料**上的门控回归 + 阈值标定。
 *
 * 门控：`FLIGHTLOG_CORPUS_DIR`（默认 manifest.root），目录不存在 → 整组 skip。
 * ⚠️ 读文件只在 `it` 体内发生（`describe.skipIf` 的回调仍会在收集阶段执行，
 *   写体内会让 CI 直接 ENOENT 变红；正确写法参照 flightlog-integration.test.ts）。
 *
 * 这里断言的是**结论纪律**（每个日志都有结论、不抛异常、unknown 一侧必须带说明），
 * 不是"没有 warning"——真实语料里确实有性能问题；实测分布打印出来供 Lead 标定阈值。
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { corpusRoot, manifest } from "./flightlog-corpus-fixture";
import { collectAll, type FileRulesReport } from "./flightlog-rules-corpus-fixture";
import { distributions, formatDistribution } from "./flightlog-rules-metrics";

const TIMEOUT = 900_000;
const ROOT = existsSync(corpusRoot()) ? corpusRoot() : null;

/**
 * 结构性 not_applicable 只允许出现这些通道（防止把"缺数据"偷换成"不适用"）。
 * Plane/Rover 的 Yaw 角度环也是结构性的：实测 ATT.DesYaw 恒 0（机型没有航向角指令），
 * 按 Lead 裁决判 not_applicable（多旋翼恒 0 才是 insufficient_data）。
 */
const ALLOWED_NOT_APPLICABLE: Readonly<Record<string, readonly string[]>> = {
  copter: ["空速环"],
  plane: ["速度环（PSC）", "Yaw 角度环"],
  rover: ["空速环", "位置环（PSC）", "Yaw 角度环"],
};

describe.skipIf(ROOT === null)("外环规则 · 真实语料（76 个 .bin，需 FLIGHTLOG_CORPUS_DIR）", () => {
  let cache: Promise<FileRulesReport[]> | null = null;
  /** 解析期间每 5 个文件让出事件循环（否则 vitest worker RPC 心跳会超时 → 整轮 exit 1） */
  function all(): Promise<FileRulesReport[]> {
    if (!cache) {
      const started = Date.now();
      cache = collectAll(ROOT as string).then((reports) => {
        const findings = reports.reduce((sum, r) => sum + r.findings, 0);
        const statuses: Record<string, number> = {};
        for (const report of reports) {
          for (const [status, count] of Object.entries(report.byStatus)) {
            statuses[status] = (statuses[status] ?? 0) + count;
          }
        }
        console.log(`\n[rules-corpus] ${reports.length} 个日志 / ${findings} 条结论 / 解析+规则 ${Date.now() - started} ms`);
        console.log(`[rules-corpus] 状态分布：${JSON.stringify(statuses)}`);
        console.log(`[rules-corpus] 无结论的日志：${reports.filter((r) => r.findings === 0).length} 个`);
        return reports;
      });
    }
    return cache;
  }

  it("76 个日志全部产出结论、不抛异常，且状态/严重度/说明纪律成立", { timeout: TIMEOUT }, async () => {
    const reports = await all();
    const problems = reports.flatMap((r) => r.problems.map((p) => `${r.file}: ${p}`));
    expect(problems).toEqual([]);
    expect(reports).toHaveLength(manifest.files.length);
    for (const report of reports) {
      expect(report.findings, `${report.file} 没有结论`).toBeGreaterThan(0);
    }
  });

  it("not_applicable 只能来自机型结构性缺失（Plane/Rover 无 PSC、无航向角指令、Copter/Rover 无空速）", { timeout: TIMEOUT }, async () => {
    const bad: string[] = [];
    for (const report of await all()) {
      const allowed = ALLOWED_NOT_APPLICABLE[report.vehicleKind] ?? [];
      for (const row of report.rows) {
        if (row.status !== "not_applicable") continue;
        if (!allowed.includes(row.subject)) {
          bad.push(`${report.file}(${report.vehicleKind}): ${row.subject}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("实测分布（标定用）：按机型 × 通道打印分位数并写 JSON", { timeout: TIMEOUT }, async () => {
    const reports = await all();
    const dist = distributions(reports);
    console.log(`\n${formatDistribution(dist)}\n`);
    // 每条通道的实测样本必须覆盖到 66 Copter / 9 Plane / 1 Rover 里有该通道的那些日志
    const copterRoll = dist.find((d) => d.vehicle === "ArduCopter" && d.subject === "Roll 角度环");
    expect(copterRoll?.n).toBeGreaterThan(50);
    const planeXt = dist.find((d) => d.vehicle === "ArduPlane" && d.subject === "航迹横向偏差");
    expect(planeXt?.n).toBe(9);

    const dir = mkdtempSync(join(tmpdir(), "flightlog-rules-corpus-"));
    const outFile = join(dir, "rules-metrics.json");
    writeFileSync(outFile, JSON.stringify({ distributions: dist, reports }, null, 2));
    console.log(`[rules-corpus] 明细已写入 ${outFile}`);
    expect(Number.isFinite(copterRoll?.errP50 ?? Number.NaN)).toBe(true);
  });

  /**
   * task-32 四条要求的语料验收（与上面同一遍解析，不额外跑第二遍 76 个文件）：
   *  ① 每一项都要有建议；② ATT>20 / FREQ 偏差≥20% 不得判 passed；
   *  ③ not_applicable 必须带原因；④ 降落段被排除且冲击单列。
   */
  it("task-32 四条要求：每项都有建议 / 滤波自相矛盾已修 / 不适用带原因 / 降落段单列", { timeout: TIMEOUT }, async () => {
    const reports = await all();
    const acc = reports.map((r) => r.acceptance);
    const noSuggestions = acc.flatMap((a, i) => a.noSuggestions.map((s) => `${reports[i].file}: ${s}`));
    const changed = reports.filter(
      (r) => r.acceptance.vibrationOld === "critical" && !r.acceptance.vibrationNew.includes("critical"),
    );
    console.log(`\n[task32] 无建议的结论：${noSuggestions.length} 条（要求 0）`);
    console.log(`[task32] not_applicable 缺原因：${acc.reduce((s, a) => s + a.naWithoutNote, 0)} 条（要求 0）`);
    console.log(`[task32] ATT>20 dB 的日志：${acc.reduce((s, a) => s + a.attSeen, 0)} / ${reports.length}；其中判 passed：${acc.reduce((s, a) => s + a.notchViolations, 0)} 条（要求 0）`);
    console.log(`[task32] FREQ 偏差≥20% 的日志：${acc.reduce((s, a) => s + a.freqOffsetSeen, 0)}；其中判 passed：${acc.reduce((s, a) => s + a.freqViolations, 0)} 条（要求 0）`);
    console.log(`[task32] 识别并排除降落段的日志：${acc.filter((a) => a.landingExcluded > 0).length} / ${reports.length}`);
    console.log(`[task32] 触发"冲击/坠机"独立结论的日志：${acc.filter((a) => a.landingFindings > 0).length}`);
    console.log(`[task32] 旧口径 critical、新口径不再 critical 的日志：${changed.length} 个（其中 ${changed.filter((r) => r.acceptance.landingFindings > 0).length} 个改为"冲击/坠机"独立结论）`);
    for (const r of changed) {
      console.log(`[task32]   ${r.file}: old=critical new=${r.acceptance.vibrationNew} 冲击结论=${r.acceptance.landingFindings} 段=${r.acceptance.landingExcluded}`);
    }
    const engineFindings = acc.reduce((s, a) => s + a.engineFindings, 0);
    const engineStatuses: Record<string, number> = {};
    for (const a of acc) for (const [k, v] of Object.entries(a.engineStatuses)) engineStatuses[k] = (engineStatuses[k] ?? 0) + v;
    console.log(`[task32] 引擎全量状态分布（7 条规则 + 门控）：${JSON.stringify(engineStatuses)}`);
    console.log(`[task32] 引擎全量结论 ${engineFindings} 条（6 条规则 + 门控结论）`);

    expect(noSuggestions).toEqual([]);
    expect(acc.every((a) => a.naWithoutNote === 0)).toBe(true);
    expect(acc.every((a) => a.notchViolations === 0)).toBe(true);
    expect(acc.every((a) => a.freqViolations === 0)).toBe(true);
    expect(acc.every((a) => a.landingExcluded > 0 || a.landingFindings === 0)).toBe(true);
    expect(engineFindings).toBeGreaterThan(reports.length);
  });
});

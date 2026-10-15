/**
 * 导航器参数规则：**误报率是验收线**。
 *  - 健康语料上"调过但合理"的值必须**一条结论都不产生**；
 *  - 只有明显不合理（越出官方合理区间）/危险（越出危险端点）才报；
 *  - 没有 PARM → missing_required；不支持的机型 → not_applicable（都不判 passed）。
 *
 * 语料门控：读文件必须在 `it` 体内惰性执行（describe 回调在收集阶段也会跑）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { parseDataflash } from "@/lib/flightlog/dataflash";
import { navigatorParamsRule } from "@/lib/flightlog/analysis/rules/navigatorParams";
import { NAV_PARAM_SPECS } from "@/lib/flightlog/analysis/rules/navigatorParamRanges";
import { makeDoc } from "./helpers/flightlogFixture";
import { corpusRoot, manifest } from "./flightlog-corpus-fixture";

const RULE = navigatorParamsRule;

/** 造一份带参数的日志（默认 Plane；参数用官方默认值或在合理区间内的自定义值） */
function docWith(params: Record<string, number>, kind: "plane" | "copter" | "rover" = "plane") {
  const doc = makeDoc({
    vehicleKind: kind,
    vehicle: kind === "plane" ? "ArduPlane" : kind === "copter" ? "ArduCopter" : "ArduRover",
    firmwareVersion: kind === "plane" ? "4.6.3" : "4.6.2",
    versionNumeric: kind === "plane" ? 40603 : 40602,
  });
  return { ...doc, params };
}

const planeDefaults = Object.fromEntries(
  NAV_PARAM_SPECS.filter(s => s.kinds.includes("plane")).map(s => [s.name, s.def]),
);
const copterDefaults = Object.fromEntries(
  NAV_PARAM_SPECS.filter(s => s.kinds.includes("copter")).map(s => [s.name, s.def]),
);

describe("导航器参数规则：判据与误报控制", () => {
  it("全部为官方默认值 → passed", () => {
    const [f] = RULE.run(createRuleContext(docWith(planeDefaults)));
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.docLinks.length).toBeGreaterThan(0);
  });

  it("**非默认但落在合理区间**（队内调参常态）→ 仍然 passed，不产生任何违规结论", () => {
    const tuned = {
      ...planeDefaults,
      NAVL1_PERIOD: 12,            // 默认 17，官方允许 10~25
      NAVL1_DAMPING: 0.85,         // 默认 0.75
      NAVL1_LIM_BANK: 55,          // 默认 45，合理区间上限 60
      TECS_CLMB_MAX: 12,           // 默认 5，合理区间上限 15
      TECS_TIME_CONST: 7.5,        // 默认 5
      RLL2SRV_TCONST: 0.8,         // 默认 0.5
      AHRS_RP_P: 0.35,             // 默认 0.2
    };
    const fs = RULE.run(createRuleContext(docWith(tuned)));
    expect(fs).toHaveLength(1);
    expect(fs[0].status).toBe("passed");
    expect(fs[0].metrics.NAVL1_PERIOD).toBe(12);
  });

  it("越出合理区间 → warning/fired，带参数改动建议与文档链接", () => {
    const fs = RULE.run(createRuleContext(docWith({ ...planeDefaults, NAVL1_PERIOD: 9 })));
    const bad = fs.find(f => f.title.includes("NAVL1_PERIOD"))!;
    expect(bad.status).toBe("fired");
    expect(bad.severity).toBe("warning");
    expect(bad.suggestions[0].param).toMatchObject({ name: "NAVL1_PERIOD", from: 9, to: 10 });
    expect(bad.docLinks[0]).toContain("ardupilot.org");
  });

  it("越过危险端点 → critical", () => {
    const fs = RULE.run(createRuleContext(docWith({ ...planeDefaults, NAVL1_PERIOD: 40 })));
    expect(fs[0].severity).toBe("critical");
    expect(fs[0].suggestions[0].param?.to).toBe(25);   // 夹回合理区间
  });

  it("只检查本机型的参数：Copter 参数不会在 Plane 日志上被报", () => {
    const fs = RULE.run(createRuleContext(docWith({ ...planeDefaults, WPNAV_SPEED: 5000 })));
    expect(fs.some(f => f.title.includes("WPNAV_SPEED"))).toBe(false);
  });

  it("交叉检查：TECS_SINK_MAX <= TECS_SINK_MIN → warning（与单参数范围无关）", () => {
    const fs = RULE.run(createRuleContext(docWith({ ...planeDefaults, TECS_SINK_MIN: 4, TECS_SINK_MAX: 3 })));
    const cross = fs.find(f => f.title.includes("相互关系"))!;
    expect(cross.severity).toBe("warning");
    expect(cross.phenomenon).toContain("必须大于");
  });

  it("Copter 日志用自己的参数表：默认值 → passed", () => {
    const [f] = RULE.run(createRuleContext(docWith(copterDefaults, "copter")));
    expect(f.status).toBe("passed");
    expect(f.metrics.PSC_POSXY_P).toBe(1);
  });

  it("机器型没有 PARM → missing_required（不判 passed）", () => {
    const [f] = RULE.run(createRuleContext(docWith({})));
    expect(f.status).toBe("missing_required");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("PARM");
  });

  it("未收录机型（rover）→ not_applicable 并说明原因", () => {
    const [f] = RULE.run(createRuleContext(docWith({}, "rover")));
    expect(f.status).toBe("not_applicable");
    expect(f.note).toContain("不在覆盖范围");
  });
});

// ── 语料门控：76 个真实 .bin（读文件在 it 体内惰性执行） ─────────────────────
const ROOT = corpusRoot();
const HAS_CORPUS = ROOT !== null && existsSync(ROOT);

describe.skipIf(!HAS_CORPUS)("导航器参数规则：76 份真实语料（分布与触发率）", () => {
  it("每个日志都有结论、不抛异常；打印每条参数的分布与触发数", () => {
    const perParam = new Map<string, number[]>();
    const triggers: { file: string; title: string; severity: string; value: number }[] = [];
    let passed = 0, missing = 0, notApplicable = 0;

    for (const entry of manifest.files) {
      // ⚠️ 惰性读：只有真正跑这个 it 时才碰磁盘（CI 没有语料 → 整组 skip）
      const bytes = new Uint8Array(readFileSync(join(ROOT, entry.file)));
      const { doc } = parseDataflash(bytes);
      const findings = RULE.run(createRuleContext(doc));
      expect(findings.length).toBeGreaterThan(0);

      for (const spec of NAV_PARAM_SPECS) {
        const v = doc.params[spec.name];
        if (typeof v === "number" && spec.kinds.includes(doc.meta.vehicleKind)) {
          if (!perParam.has(spec.name)) perParam.set(spec.name, []);
          perParam.get(spec.name)!.push(v);
        }
      }
      for (const f of findings) {
        if (f.status === "passed") passed++;
        else if (f.status === "missing_required") missing++;
        else if (f.status === "not_applicable") notApplicable++;
        else triggers.push({ file: entry.file, title: f.title.split("：").pop()!, severity: f.severity, value: f.metrics.value ?? 0 });
      }
    }

    console.log(`[nav] 76 份：passed=${passed} missing_required=${missing} not_applicable=${notApplicable} 违规结论=${triggers.length}`);
    console.log(`[nav] 触发明细：${JSON.stringify(triggers)}`);
    for (const [name, values] of [...perParam.entries()].sort()) {
      const sorted = [...values].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      console.log(`[nav] ${name}: n=${sorted.length} min=${sorted[0]} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} max=${sorted[sorted.length - 1]}`);
    }

    // 误报率验收线：违规结论必须远少于日志数（健康语料上不该满屏报警）
    expect(passed).toBeGreaterThan(0);
    expect(triggers.length).toBeLessThanOrEqual(5);
  }, 20 * 60 * 1000);
});

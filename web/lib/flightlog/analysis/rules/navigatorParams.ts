/**
 * 规则 4：导航器 / 控制参数
 *
 * 用户诉求「诊断导航器参数」。设计口径（**误报率是验收线**）：
 *  - 只报**有据可依**的偏差：每条参数在 `navigatorParamRanges.ts` 里有官方默认值、很宽的合理区间、
 *    危险端点与文档链接；**落在合理区间内的自定义值一律不产生结论**（队内调参是常态）；
 *  - 只对**本机型**收录的参数做检查（同一参数名在 Plane/Copter 上语义不同）；
 *  - 一条参数都不认识 / 日志里没有 PARM → 落 unknown 一侧（`missing_required` / `not_applicable`），
 *    **绝不判 passed**；
 *  - 参数规则不依赖任何序列数据（无 PARM 之外的依赖），也不需要 arm 窗口。
 */

import type { Finding, Severity } from "../../types/report";
import type { Rule, RuleContext } from "../../types/rule";
import { makeFinding, step, suggestion, unknownFinding } from "../finding";
import {
  NAV_PARAM_SPECS, classifyParam, clampToOk, crossCheckParams, type ParamSpec, type ParamVerdict,
} from "./navigatorParamRanges";

const RULE_ID = "navigator_params";
const TITLE = "导航器 / 控制参数";
/** 机型 → 该机型参数范围的说明文档 */
const MODEL_DOC: Readonly<Record<string, string>> = {
  plane: "https://ardupilot.org/plane/docs/parameters.html",
  copter: "https://ardupilot.org/copter/docs/parameters.html",
};

const SEVERITY_OF: Readonly<Record<ParamVerdict, Severity>> = {
  ok: "ok", warning: "warning", critical: "critical",
};

function fmt(spec: ParamSpec, v: number): string {
  return `${spec.name} = ${v}${spec.unit ? ` ${spec.unit}` : ""}`;
}

function violationFinding(spec: ParamSpec, value: number, verdict: ParamVerdict): Finding {
  const target = clampToOk(spec, value);
  const range = `[${spec.ok[0]}, ${spec.ok[1]}]${spec.unit ? ` ${spec.unit}` : ""}`;
  return makeFinding({
    ruleId: RULE_ID,
    title: `${TITLE}：${spec.name}`,
    severity: SEVERITY_OF[verdict],
    status: "fired",
    phenomenon: `${fmt(spec, value)} 超出官方合理区间 ${range}（默认 ${spec.def}）`,
    impact: verdict === "critical"
      ? "该取值已明显偏离安全/可用范围，可能直接导致飞行品质问题"
      : "该取值偏离常规范围，飞行品质可能下降（但仍在可解释区间附近）",
    evidence: [
      step("参数值", `${fmt(spec, value)}（官方默认 ${spec.def}）`),
      step("判据", `合理区间 ${range}，危险端点 [${spec.danger[0]}, ${spec.danger[1]}]；${spec.why}`),
      step("判定口径", verdict === "critical" ? "越过危险端点 → 严重" : "越出合理区间但未到危险端点 → 警告"),
    ],
    metrics: { value, default: spec.def, okMin: spec.ok[0], okMax: spec.ok[1] },
    suggestions: [
      suggestion(1, `把 ${spec.name} 调到合理区间内（官方默认 ${spec.def}）`, {
        param: { name: spec.name, from: value, to: target, reason: spec.why },
        verify: `改动后复飞，确认与 ${spec.name} 相关的飞行品质指标（如航线跟随/姿态响应）改善且无新的振荡`,
      }),
    ],
    docLinks: [spec.doc],
    note: "参数偏离不等于故障：如果你是有意调成这个值，请以复飞验证为准。",
  });
}

export const navigatorParamsRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "params",
  appliesTo: [
    {
      platform: "ardupilot",
      requires: [],
      optional: ["PARM"],
      note: "参数规则只读 PARM，不需要序列数据；合理区间来自官方文档，区间内的自定义值不报警",
    },
  ],
  run(ctx: RuleContext) {
    const kind = ctx.doc.meta.vehicleKind;
    const specs = NAV_PARAM_SPECS.filter(s => s.kinds.includes(kind));
    if (specs.length === 0) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "not_applicable",
        note: `本规则目前只收录 Plane 与 Copter 的导航参数范围；当前机型 ${ctx.doc.meta.vehicle}（${kind}）不在覆盖范围，因此不作判断。`,
      })];
    }

    const present = specs
      .map(spec => ({ spec, value: ctx.param(spec.name) }))
      .filter((x): x is { spec: ParamSpec; value: number } => x.value !== null);

    if (present.length === 0) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        note: `日志里没有这些导航参数的 PARM 记录（本机型应收录 ${specs.length} 条：${specs.map(s => s.name).join("、")}），无法评估参数是否合理 —— 这不代表参数没问题。`,
      })];
    }

    const violations = present
      .map(({ spec, value }) => ({ spec, value, verdict: classifyParam(spec, value) }))
      .filter(v => v.verdict !== "ok");

    const crossNote = crossCheckParams(name => ctx.param(name));
    const findings: Finding[] = violations.map(v => violationFinding(v.spec, v.value, v.verdict));

    if (crossNote) {
      findings.push(makeFinding({
        ruleId: RULE_ID, title: `${TITLE}：参数相互关系`, severity: "warning", status: "fired",
        phenomenon: crossNote,
        impact: "相关参数组合在一起不自洽，可能导致能量/姿态控制行为异常",
        evidence: [step("交叉检查", crossNote), step("口径", "只检查参数之间的相互关系，不改动单个参数的合理区间判定")],
        docLinks: [DOC_TECS_RULE],
        note: null,
      }));
    }

    if (findings.length === 0) {
      // 有数据、检查执行且全部落在合理区间 → 才是 passed
      findings.push(makeFinding({
        ruleId: RULE_ID, title: TITLE, severity: "ok", status: "passed",
        phenomenon: `已检查 ${present.length} 条导航参数，全部落在官方合理区间内`,
        impact: "未发现参数层面的明显隐患",
        evidence: [
          step("已检查参数", present.map(({ spec, value }) => fmt(spec, value)).join("；")),
          step("判据", "每条参数使用官方默认值 + 合理区间 + 危险端点；区间内的自定义值一律不报警"),
        ],
        metrics: Object.fromEntries(present.map(({ spec, value }) => [spec.name, value])),
        docLinks: [MODEL_DOC[kind] ?? DOC_TECS_RULE],
        note: null,
      }));
    }

    return findings;
  },
};

/** TECS 参数文档（交叉检查与建议引用） */
const DOC_TECS_RULE = "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html";

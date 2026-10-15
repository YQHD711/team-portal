/**
 * 通道级的"不适用 / 缺数据"结论构造。
 *
 * 两条纪律：
 *  ① **必须带 axis**：UI 才能按轴分组展示"哪个轴不适用、哪个轴缺数据"——
 *     这正是 task-27 第 1 条的要求：不适用只影响该通道，绝不能把整条规则打成 missing_required；
 *  ② **必须带建议**（用户：「每一项都有建议」）：unknown 一侧不给参数数值，
 *     只给"先补齐哪份数据 / 该机型该看哪个同类结论"+ 缺什么，避免用户拿着无法判断的结论去调参。
 *
 * 状态口径：机型本来没有该通道（固定翼没有 PSC、多旋翼没有空速）→ `not_applicable`；
 * 该机型本该有但日志里没有/样本不足 → `missing_required` / `insufficient_data`。
 */

import type { Finding, Suggestion } from "../types/report";
import { makeFinding } from "./finding";
import { dataGapStep } from "./rules/tuningSteps";
import type { PairUnavailable } from "./trackingEvidence";

const UNKNOWN_PHENOMENON = "未能完成检查";
const UNKNOWN_IMPACT = "无法判断该方面是否存在问题，不代表通过";

/** 通道级"无法判断"（缺 arm 窗口等全局原因，不属于任何单通道）——同样要给建议 */
export function globalInsufficient(ruleId: string, ruleTitle: string, note: string, doc = ""): Finding {
  return makeFinding({
    ruleId,
    title: ruleTitle,
    severity: "unknown",
    status: "insufficient_data",
    phenomenon: UNKNOWN_PHENOMENON,
    impact: UNKNOWN_IMPACT,
    note,
    suggestions: [
      dataGapStep({
        signature: "缺少可用的飞行（arm）窗口，无法做飞行段统计",
        missing: note,
        howToFix: "确认日志含 ARM/解锁事件（或时长信息）后复飞重采；本条不代表通过",
        doc,
      }),
    ],
  });
}

function advice(args: {
  suggestions?: readonly Suggestion[];
  signature: string;
  missing: string;
  howToFix: string;
  doc?: string;
}): readonly Suggestion[] {
  if (args.suggestions && args.suggestions.length > 0) return args.suggestions;
  return [
    dataGapStep({
      signature: args.signature,
      missing: args.missing,
      howToFix: args.howToFix,
      doc: args.doc ?? "",
    }),
  ];
}

export function notApplicable(args: {
  ruleId: string;
  ruleTitle: string;
  subject: string;
  note: string;
  axis?: Finding["axis"];
  /** 该通道不适用的机型，用于建议文案（如 "固定翼"） */
  vehicleLabel?: string;
  suggestions?: readonly Suggestion[];
  doc?: string;
}): Finding {
  return makeFinding({
    ruleId: args.ruleId,
    title: `${args.ruleTitle}（${args.subject}）`,
    severity: "unknown",
    status: "not_applicable",
    phenomenon: UNKNOWN_PHENOMENON,
    impact: UNKNOWN_IMPACT,
    note: args.note,
    axis: args.axis ?? null,
    suggestions: advice({
      suggestions: args.suggestions,
      signature: `${args.vehicleLabel ?? "本机型"} 没有「${args.subject}」这个通道`,
      missing: args.note,
      howToFix: `该通道不适用，不需要调参；请改看本机型对应的同类结论（同一份报告里其余通道的结论仍然有效）`,
      doc: args.doc,
    }),
  });
}

export function unavailable(args: {
  ruleId: string;
  ruleTitle: string;
  subject: string;
  pair: PairUnavailable;
  /** true = 该机型本该有该通道（缺消息算 missing_required，否则算 insufficient_data） */
  missingIsRequired: boolean;
  axis?: Finding["axis"];
  suggestions?: readonly Suggestion[];
  doc?: string;
}): Finding {
  return makeFinding({
    ruleId: args.ruleId,
    title: `${args.ruleTitle}（${args.subject}）`,
    severity: "unknown",
    status: args.pair.kind === "missing" && args.missingIsRequired ? "missing_required" : "insufficient_data",
    phenomenon: UNKNOWN_PHENOMENON,
    impact: UNKNOWN_IMPACT,
    note: args.pair.detail,
    axis: args.axis ?? null,
    suggestions: advice({
      suggestions: args.suggestions,
      signature: `${args.subject}缺数据（${args.pair.detail}）`,
      missing: args.pair.detail,
      howToFix: "确认该机型确实应当记录这条消息与字段（版本/日志配置），然后按同一载重复飞重采",
      doc: args.doc,
    }),
  });
}

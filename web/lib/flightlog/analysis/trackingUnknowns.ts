/**
 * 通道级的"不适用 / 缺数据"结论构造。
 *
 * 为什么单独一处（而不是塞进 trackingFindings.ts）：这两类结论必须**带 axis**，
 * UI 才能按轴分组展示"哪个轴不适用、哪个轴缺数据"——
 * 这正是 task-27 第 1 条的要求：不适用只影响该通道，绝不能把整条规则打成 missing_required。
 *
 * 状态口径：airframe 本来就没有该通道（如固定翼没有 PSC*、多旋翼没有空速）→ `not_applicable`；
 * 该机型本该有但日志里没有/样本不足 → `missing_required` / `insufficient_data`。
 * 三者都属于 unknown 一侧，**绝不**降级成 passed。
 */

import type { Finding } from "../types/report";
import { makeFinding } from "./finding";
import type { PairUnavailable } from "./trackingEvidence";

const UNKNOWN_PHENOMENON = "未能完成检查";
const UNKNOWN_IMPACT = "无法判断该方面是否存在问题，不代表通过";

export function notApplicable(args: {
  ruleId: string;
  ruleTitle: string;
  subject: string;
  note: string;
  axis?: Finding["axis"];
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
  });
}

/**
 * ULog 覆盖度/跳过类警告的文本装配（从 ulogScan.ts 拆出：原文件超过 200 行上限）。
 *
 * 纪律：**覆盖度不完整、未知消息类型、非数值参数、dropout 都必须能被看到**——
 * 解析器"尽力而为"的部分绝不能悄悄消失（否则用户会把"没解析到"读成"没有问题"）。
 */

import type { UlogSeriesResult } from "./ulogSeries";

export interface CoverageWarningsInput {
  built: UlogSeriesResult;
  unknownTypes: ReadonlyMap<string, number>;
  droppedParams: ReadonlySet<string>;
  dropouts: number;
}

export function emitCoverageWarnings(input: CoverageWarningsInput, warn: (message: string) => void): void {
  const { built, unknownTypes, droppedParams, dropouts } = input;

  for (const topic of built.counts.keys()) {
    if (!built.decodedFields.has(topic)) warn(`topic ${topic} 只计数未解码字段，覆盖度不完整`);
  }
  if (built.noTimestamp.length > 0) {
    const n = built.noTimestamp.length;
    const names = built.noTimestamp.slice(0, 8).join("、");
    warn(`${n} 个 topic 没有 timestamp 字段，只计数未产出 Series：${names}${n > 8 ? "…" : ""}`);
  }
  if (unknownTypes.size > 0) {
    const detail = [...unknownTypes.entries()].map(([t, n]) => `${t}×${n}`).join("、");
    const total = [...unknownTypes.values()].reduce((a, b) => a + b, 0);
    warn(`出现 ${total} 条未知消息类型（${detail}），已按头部长度跳过`);
  }
  if (droppedParams.size > 0) {
    warn(`${droppedParams.size} 个参数是非数值类型，未纳入 params：${[...droppedParams].slice(0, 6).join("、")}`);
  }
  if (dropouts > 0) warn(`日志里有 ${dropouts} 条 dropout（记录丢失）消息，采集期间有数据缺口`);
}

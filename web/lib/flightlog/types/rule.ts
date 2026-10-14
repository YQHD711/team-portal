/**
 * 诊断规则契约。
 *
 * 规则是**确定性**逻辑：同样输入必须同样输出，不调用模型、不访问网络。
 * 每条规则声明 applies_to（平台 + 版本区间 + 依赖消息），版本不匹配时
 * 引擎输出 not_applicable 并附原因，**绝不**误判或静默跳过。
 */

import type {
  ArmedWindow,
  LogDocument,
  Platform,
  Series,
  TimeWindow,
} from "./log";
import type { Finding } from "./report";

export type RuleCategory =
  | "vibration"
  | "pid"
  | "filter"
  | "gps"
  | "power"
  | "attitude"
  | "params"
  | "crash";

export interface RuleAppliesTo {
  platform: Platform;
  /** 数值版本区间（含端点，major*10000+minor*100+patch）；不填表示不限 */
  minVersion?: number;
  maxVersion?: number;
  /** 必需消息：缺任一 → status = missing_required */
  requires: readonly string[];
  /** 可选消息：缺失时改变判定分支，而不是判定不适用 */
  optional?: readonly string[];
  /** 抽象参数名 -> 该平台/版本的参数名，如 { ratePitchP: "ATC_RAT_PIT_P" } */
  paramMap?: Readonly<Record<string, string>>;
  /** 展示给用户的口径说明，如 "ArduPilot 4.4+ 才有 PIDR 逐项日志" */
  note?: string;
}

/** 裁剪到窗口内的一组样本（时间与值等长） */
export interface SeriesWindow {
  timeSec: Float64Array;
  values: Float64Array;
}

export interface RuleContext {
  doc: LogDocument;
  /** 取序列；不存在返回 null（不要抛异常） */
  series(name: string, instance?: number): Series | null;
  /** 取参数；不存在返回 null */
  param(name: string): number | null;
  /** 已识别的 arm 窗口，按时间升序；无 arm 记录时返回空数组 */
  armedWindows(): readonly ArmedWindow[];
  /** 取某序列字段并裁剪到窗口；序列/字段缺失或窗口内无样本时返回 null */
  windowed(
    name: string,
    field: string,
    w: TimeWindow,
    instance?: number,
  ): SeriesWindow | null;
}

export interface Rule {
  id: string;
  title: string;
  category: RuleCategory;
  appliesTo: readonly RuleAppliesTo[];
  /**
   * 返回 0..n 条 Finding。可以返回"通过"（severity=ok / status=passed）。
   * 阈值与计算过程必须写进 evidence 与 metrics，保证可审计。
   */
  run(ctx: RuleContext): Finding[];
}

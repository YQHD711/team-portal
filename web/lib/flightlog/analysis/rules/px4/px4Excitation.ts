/**
 * PX4 的**激励门槛**（task-34；Lead 纠偏后的纪律）。
 *
 * 为什么必须有：**没有激励时"误差为 0"不代表跟踪好，只代表没动**。
 * 判 passed 必须同时满足「有足够激励」+「误差小」——只有误差小是不够的。
 *
 * 实测标定（真实 `.ulg`，3 份代表日志的 armed 窗口，`FLIGHTLOG_ULOG_DIR` 门控）：
 *  - 速率环指令变化（std）：roll **0.157 / 0.214 rad/s** → 门槛取 **0.05 rad/s**（≈2.9 °/s，比实测最低值低 3 倍）
 *  - 角度环指令变化（std）：roll **1.207 / 2.330°**、yaw **37.9 / 147.7°** → 门槛取 roll/pitch **0.5°**、yaw **2°**
 *  - 角度误差 RMS 实测 0.45 / 1.89 / 2.77°（另 log_11 为 3.99–4.54°）→ 角度告警阈值取 **6°/12°**
 *    （起点值：仅在 4 份真实日志上复核，`px4AttitudeLoop.PX4_ANGLE_DEG` 与本注释保持同步）
 *
 * 判据用的不是"指令 RMS"而是**指令变化（std）**：恒定 11.5° 的指令 RMS 很大但 std=0，
 * 那正是"没动却被判通过"的情形；用 RMS 会漏掉它。两种数字都会写进 note，便于用户判断。
 *
 * ⚠️ 与 ArduPilot 裁决 2 的关系（两者必须同时成立）：
 *  - **比值判据**（速率环 Err/Tar）：低于门槛一律 `insufficient_data`（小分母会把比值放大）；
 *  - **绝对量判据**（角度环的度）：低激励**且误差也小** → `insufficient_data`（没动，无法评价）；
 *    低激励但**误差很大** → 照常 fired（那是真实存在的姿态误差，不能藏）。
 */

import type { RuleContext } from "../../../types/rule";
import type { Px4Axis } from "./px4ParamNames";

/** 速率环指令变化门槛（rad/s） */
export const PX4_MIN_RATE_CMD_STD_RAD_S = 0.05;

/**
 * 指令↔实际互相关峰值的可信下限。实测：`log_100` 峰值 **0.90**（可判）、`log_11` 只有 **0.12**
 * —— 后者的两条 topic 根本对不上（记录率/时间基准问题），据它判分级会给出 D 级假红。
 * 因此低于该下限一律判"无法评价"，而不是硬判。
 */
export const PX4_MIN_PEAK_CORR = 0.5;

/** 速率环滞后在毫秒上的合理上限：超过它更像记录/时间戳错位，不能据此加前馈（实测 log_100 峰值在 +190 ms） */
export const PX4_PLAUSIBLE_LAG_MS = 60;

/** 角度环指令变化门槛（度；std） */
export const PX4_MIN_ANGLE_CMD_STD_DEG: Readonly<Record<Px4Axis, number>> = {
  roll: 0.5,
  pitch: 0.5,
  yaw: 2,
};

export interface Px4Excitation {
  /** 指令变化（std） */
  cmdStd: number;
  /** 指令 RMS（一并展示，便于用户理解为什么判"没动"） */
  cmdRms: number;
  /** 是否达到门槛 */
  sufficient: boolean;
}

/** 指令激励（在给定窗口内取指定字段的 std/RMS） */
export function excitationOf(
  ctx: RuleContext,
  topic: string,
  field: string,
  window: { startSec: number; endSec: number },
  stdOf: (values: Float64Array) => number,
  rmsOf: (values: Float64Array) => number,
): Px4Excitation | null {
  const series = ctx.windowed(topic, field, window);
  if (!series || series.values.length < 10) return null;
  return { cmdStd: stdOf(series.values), cmdRms: rmsOf(series.values), sufficient: true };
}

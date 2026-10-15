/**
 * 规则注册表。新增规则只需在此登记（**顺序即报告中的展示顺序**）。
 *
 * 每条规则的 id 必须稳定——它是前端折叠状态、测试断言与文档引用的键。
 *
 * 展示顺序按「控制链 + 硬件」组织，而不是按开发顺序：
 *   硬件/机械（振动、滤波）→ 外环（位置、速度）→ 中环（角度）→ 内环（速率）→ 参数 → 机型专用（TECS）
 * 这样用户从上往下读，就是"从机械到控制、从外环到内环"的定位顺序。
 */

import type { Rule } from "../../types/rule";
import { vibrationRule } from "./vibration";
import { filterNotchRule } from "./filterNotch";
import { speedPositionTrackingRule } from "./speedPositionTracking";
import { attitudeTrackingRule } from "./attitudeTracking";
import { pidRateTrackingRule } from "./pidRateTracking";
import { navigatorParamsRule } from "./navigatorParams";
import { tecsTrackingRule } from "./tecsTracking";
// PX4 专属规则（applies_to.platform = "px4"）排在最后：
// 在 ArduPilot 日志上会被平台门控判 not_applicable，并由前端折叠为一行汇总。
import { px4AttitudeTrackingRule, px4RateTrackingRule, px4SaturationRule } from "./px4";
import { px4VibrationFilterRule } from "./px4/health/vibrationFilter";

export const ALL_RULES: readonly Rule[] = [
  vibrationRule,
  filterNotchRule,
  speedPositionTrackingRule,
  attitudeTrackingRule,
  pidRateTrackingRule,
  navigatorParamsRule,
  tecsTrackingRule,
  px4RateTrackingRule,
  px4AttitudeTrackingRule,
  px4SaturationRule,
  px4VibrationFilterRule,
];

export {
  vibrationRule,
  filterNotchRule,
  speedPositionTrackingRule,
  attitudeTrackingRule,
  pidRateTrackingRule,
  navigatorParamsRule,
  tecsTrackingRule,
  px4RateTrackingRule,
  px4AttitudeTrackingRule,
  px4SaturationRule,
  px4VibrationFilterRule,
};

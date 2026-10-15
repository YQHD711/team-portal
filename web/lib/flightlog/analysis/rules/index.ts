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

export const ALL_RULES: readonly Rule[] = [
  vibrationRule,
  filterNotchRule,
  speedPositionTrackingRule,
  attitudeTrackingRule,
  pidRateTrackingRule,
  navigatorParamsRule,
  tecsTrackingRule,
];

export {
  vibrationRule,
  filterNotchRule,
  speedPositionTrackingRule,
  attitudeTrackingRule,
  pidRateTrackingRule,
  navigatorParamsRule,
  tecsTrackingRule,
};

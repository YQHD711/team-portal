/**
 * 规则注册表。新增规则只需在此登记（顺序即报告中的展示顺序）。
 *
 * 每条规则的 id 必须稳定——它是前端折叠状态、测试断言与文档引用的键。
 */

import type { Rule } from "../../types/rule";
import { vibrationRule } from "./vibration";
import { pidRateTrackingRule } from "./pidRateTracking";
import { filterNotchRule } from "./filterNotch";

export const ALL_RULES: readonly Rule[] = [
  vibrationRule,
  pidRateTrackingRule,
  filterNotchRule,
];

export { vibrationRule, pidRateTrackingRule, filterNotchRule };

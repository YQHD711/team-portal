/**
 * PX4 控制环规则（task-34）的对外出口。
 *
 * ⚠️ 注册到 `rules/index.ts` 由 Lead 负责（本任务不动那个文件）。
 * 测试与将来的引擎直接 `import { px4RateTrackingRule } from "./rules/px4"` 即可。
 */

export { px4RateTrackingRule, PX4_RATE_RULE_ID, PX4_RATE_TITLE } from "./px4RateLoop";
export { px4AttitudeTrackingRule, PX4_ATT_RULE_ID, PX4_ATT_TITLE, PX4_ANGLE_DEG } from "./px4AttitudeLoop";
export { px4AnglePair } from "./px4AnglePair";
export { px4SaturationRule } from "./px4SaturationRule";
export { collectControlEvidence, biasedChannels, SATURATION_RATIO_WARN } from "./px4ControlSignals";
export type { ControlEvidence, ChannelStat } from "./px4ControlSignals";
export { collectPx4RateMetrics, gradePx4Rate, PX4_RATE_GRADE_BANDS } from "./px4RateMetrics";
export type { Px4RateMetrics } from "./px4RateMetrics";
export {
  px4Family, px4FfPolicy, resolvePx4RateParams, resolvePx4AngleGain, px4RatePrefixes, px4IntLimitCandidates,
} from "./px4ParamNames";
export type { Px4Axis, Px4RateParams } from "./px4ParamNames";

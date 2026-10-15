/**
 * 规则：速度环 / 位置环（外环）—— **按机型分支**。
 *
 *   Copter：PSCN/PSCE/PSCD 的 `TV*−V*`（比值判据）+ `TP*−P*`（绝对米判据）
 *   Plane ：TECS `spdem−sp` 空速（比值）+ NTUN `XT`/`AltE`（绝对米）
 *   Rover ：NTUN `XTrack`（绝对米）；空速/位置控制器通道 not_applicable
 *
 * 三条实测教训与通道表见 `speedPositionChannels.ts` 头部；判据与结论构造在
 * `../trackingFindings.ts`（与角度环共用），本文件只做"取数 → 判定 → 装配"。
 *
 * ⚠️ 位置/高度环的激励守卫用**配对的目标速度 RMS**：位置环的输出是速度指令，
 *   目标速度没动过就说明这台机没在位置控制下运动，此时位置偏差无评价意义。
 *   守卫数值会写进 evidence，保证可审计（不靠"看起来合理"）。
 */

import type { Finding } from "../../types/report";
import type { Rule, RuleContext } from "../../types/rule";
import type { TimeWindow } from "../../types/log";
import { longestWindow } from "../windows";
import {
  deviationPair, extractPair, timeAxis, type TrackingPair,
} from "../trackingEvidence";
import { absoluteThresholds, highlightFor, ratioThresholds, trackingChart } from "../trackingCharts";
import { channelFinding } from "../trackingFindings";
import { globalInsufficient, unavailable } from "../trackingUnknowns";
import {
  channelsFor, structuralGaps, suggestionsFor, type Channel,
} from "./speedPositionChannels";
import { SPEED_POSITION } from "../thresholds";

const RULE_ID = "speed_position_tracking";
const TITLE = "速度环 / 位置环跟踪";
const DOCS = [
  "https://ardupilot.org/copter/docs/tuning-process-instructions.html",
  "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html",
  "https://ardupilot.org/rover/docs/rover-tuning.html",
];

/** 取一对目标/实际列，或一个偏差列（XT/AltE/XTrack 的目标恒为 0） */
function pairFor(ctx: RuleContext, channel: Channel, window: TimeWindow) {
  if (channel.deviationField) {
    return deviationPair(ctx, channel.message, channel.deviationField, window, SPEED_POSITION.minSamples, {
      missingDetail: channel.missingDetail
        ?? `${channel.message} 没有 ${channel.deviationField} 列，${channel.subject}无法评估`,
    });
  }
  return extractPair(
    ctx,
    channel.message,
    channel.targetField as string,
    channel.actualField as string,
    window,
    SPEED_POSITION.minSamples,
    {
      missingDetail: channel.missingDetail
        ?? `${channel.message} 缺少 ${channel.targetField}/${channel.actualField} 列，${channel.subject}无法评估`,
    },
  );
}

function channelFindingFor(ctx: RuleContext, channel: Channel, window: TimeWindow): Finding {
  const pair = pairFor(ctx, channel, window);
  if ("kind" in pair) {
    return unavailable({
      ruleId: RULE_ID,
      ruleTitle: TITLE,
      subject: channel.subject,
      pair,
      missingIsRequired: channel.missingIsRequired,
    });
  }

  const tracked: TrackingPair = pair;

  const targetField = channel.targetField ?? (channel.deviationField as string);
  const actualField = channel.actualField ?? (channel.deviationField as string);
  const chart = trackingChart({
    id: `${RULE_ID}-${channel.subject}`,
    title: `${channel.subject}：目标 / 实际 / 误差`,
    message: channel.message,
    targetField,
    actualField,
    targetLabel: channel.deviationField ? `${channel.subject}（偏差列，目标恒 0）` : `目标 ${targetField}`,
    actualLabel: channel.actualField ? `实际 ${actualField}` : `${channel.subject} ${actualField}`,
    window,
    thresholds: channel.mode === "ratio"
      ? ratioThresholds(channel.warning, channel.critical)
      : absoluteThresholds(channel.warning, channel.critical, channel.errorUnit),
    highlight: highlightFor(timeAxis(ctx, channel.message, window, pair.samples), pair.error,
      channel.mode === "ratio" ? 0 : channel.warning),
  });

  return channelFinding({
    ruleId: RULE_ID,
    ruleTitle: TITLE,
    subject: channel.subject,
    axis: null,
    pair: tracked,
    mode: channel.mode,
    errorUnit: channel.errorUnit,
    excitationUnit: channel.excitationUnit,
    warning: channel.warning,
    critical: channel.critical,
    minExcitation: channel.minExcitation,   // 只有比值判据有值；位置/高度是绝对量，不传
    chart,
    docLinks: DOCS,
    suggestions: suggestionsFor(channel),
    zeroDeviationIsUnknown: channel.deviationField !== undefined,
  });
}

export const speedPositionTrackingRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "pid",
  appliesTo: [
    {
      platform: "ardupilot",
      minVersion: 30400,
      // 故意留空：Copter 用 PSC、Plane 用 TECS/NTUN、Rover 用 NTUN.XTrack，
      // 不能用任一机型专有的消息当整条规则门槛（上一轮 PID 规则的线上事故）
      requires: [],
      optional: ["PSCN", "PSCE", "PSCD", "TECS", "NTUN", "CTUN"],
      note: "按机型分支：Copter=PSC 速度/位置；Plane=TECS spdem/sp + NTUN XT/AltE（无 PSC）；"
        + "Rover=NTUN XTrack；CTUN.AsT 实测不是有效目标空速，不用它做判据",
    },
  ],
  run(ctx: RuleContext) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [globalInsufficient(RULE_ID, TITLE, "没有可用的飞行（arm）时间段，无法评估速度/位置环跟踪")];
    }
    const kind = ctx.doc.meta.vehicleKind;
    return [
      ...structuralGaps(kind),
      ...channelsFor(kind).map((channel) => channelFindingFor(ctx, channel, window)),
    ];
  },
};

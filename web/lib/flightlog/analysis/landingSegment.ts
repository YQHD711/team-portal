/**
 * 降落/触地段的识别（供振动规则把"触地冲击"与"机架振动"分开）。
 *
 * 用户反馈：「有时候降落坠机产生的震动不能算异常的一部分」。落地冲击在 arm 窗口内，
 * 会把 std 与 clip 直接拉爆 → 判成"振动异常"，但那是**事件**，不是机架振动问题。
 *
 * 识别依据（按可信度从高到低，全部写进 evidence，绝不静默处理）：
 *  ① **MODE 事件**：机型对应的进场/降落模式（Copter 6 RTL / 9 LAND / 21 SmartRTL；
 *     Plane 11 RTL / 21 QLand / 22 QRTL；Rover 4 Hold / 11 RTL / 12 SmartRTL）；
 *  ② **EV 事件码**：17「可能已着陆」/ 18「着陆完成」→ 取该时刻前 2 s 为起点
 *     （事件在触地后才产生，往前留一点余量）；
 *  ③ **CTUN.Alt 下降段**：disarm 前最后 60 s 内的最高点，若之后单调下降 ≥3 m 且持续 ≥3 s；
 *  ④ **兜底**：disarm 前 5 s（明确标注为**启发式**，可信度最低）；
 *  ⑤ 识别不出来（没有 disarm 事件、也没有 MODE/EV/Alt 线索）→ 返回 null，
 *     调用方必须如实说明"未排除降落段"，不许当成异常、也不许默默丢掉。
 */

import type { RuleContext } from "../types/rule";
import type { TimeWindow } from "../types/log";

export type LandingConfidence = "mode" | "event" | "descent" | "heuristic" | "unknown";

export interface LandingDetection {
  /** 待排除的降落/触地段；识别不出时为 null */
  window: TimeWindow | null;
  /** 写进 evidence 的依据说明（含具体时间与线索） */
  basis: string;
  confidence: LandingConfidence;
  disarmSec: number | null;
}

/** 机型对应的"进场/降落"模式编号（表不完整：只收录确定语义的；未知模式一律忽略） */
const LANDING_MODES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  copter: { 6: "RTL", 9: "LAND", 21: "SmartRTL" },
  sub: { 6: "RTL", 9: "LAND", 21: "SmartRTL" },
  plane: { 11: "RTL", 21: "QLand", 22: "QRTL" },
  rover: { 4: "Hold", 11: "RTL", 12: "SmartRTL" },
};

const HEURISTIC_SEC = 5;
const EVENT_LEAD_SEC = 2;
const DESCENT_MIN_M = 3;
const DESCENT_MIN_SEC = 3;
const DESCENT_LOOKBACK_SEC = 60;

function lastDisarm(ctx: RuleContext, window: TimeWindow): number | null {
  let t: number | null = null;
  for (const e of ctx.doc.events) {
    if (e.kind !== "disarm") continue;
    if (e.tSec < window.startSec || e.tSec > window.endSec) continue;
    if (t === null || e.tSec > t) t = e.tSec;
  }
  return t;
}

/** CTUN.Alt 的最后一段持续下降（返回下降起点；找不到返回 null） */
function descentStart(ctx: RuleContext, window: TimeWindow, untilSec: number): number | null {
  const alt = ctx.windowed("CTUN", "Alt", window);
  if (!alt || alt.values.length < 10) return null;
  const from = Math.max(window.startSec, untilSec - DESCENT_LOOKBACK_SEC);
  // 取回看窗口内的最高点作为下降起点候选（最高点之后必须持续下降）
  let peakIdx = -1;
  for (let i = 0; i < alt.timeSec.length; i += 1) {
    const t = alt.timeSec[i];
    if (t < from || t > untilSec) continue;
    if (peakIdx < 0 || alt.values[i] > alt.values[peakIdx]) peakIdx = i;
  }
  if (peakIdx < 0) return null;
  const peakAlt = alt.values[peakIdx];
  const peakSec = alt.timeSec[peakIdx];
  let lastSec = peakSec;
  let lastAlt = peakAlt;
  for (let i = peakIdx + 1; i < alt.timeSec.length && alt.timeSec[i] <= untilSec; i += 1) {
    // 允许 ≤0.5 m 的抖动，但整体必须单调下降
    if (alt.values[i] > lastAlt + 0.5) return null;
    lastSec = alt.timeSec[i];
    lastAlt = alt.values[i];
  }
  if (peakAlt - lastAlt >= DESCENT_MIN_M && lastSec - peakSec >= DESCENT_MIN_SEC) return peakSec;
  return null;
}

export function detectLanding(ctx: RuleContext, window: TimeWindow): LandingDetection {
  const disarmSec = lastDisarm(ctx, window);
  const kind = ctx.doc.meta.vehicleKind;
  const modes = LANDING_MODES[kind] ?? {};

  // ① MODE 事件（最可信）
  let bestMode: { tSec: number; name: string } | null = null;
  for (const e of ctx.doc.events) {
    if (e.kind !== "mode" || e.code === undefined) continue;
    const name = modes[e.code];
    if (!name) continue;
    if (e.tSec < window.startSec || e.tSec > window.endSec) continue;
    if (!bestMode || e.tSec > bestMode.tSec) bestMode = { tSec: e.tSec, name: `${name}（MODE=${e.code}）` };
  }
  if (bestMode !== null) {
    const end = disarmSec !== null && disarmSec > bestMode.tSec ? disarmSec : window.endSec;
    return {
      window: { startSec: bestMode.tSec, endSec: end },
      basis: `MODE 事件：${bestMode.name} 于 ${bestMode.tSec.toFixed(1)}s 进入，排除至 ${end.toFixed(1)}s`,
      confidence: "mode",
      disarmSec,
    };
  }

  // ② EV 17/18（着陆完成/可能已着陆）
  let bestEv: number | null = null;
  for (const e of ctx.doc.events) {
    if (e.code !== 17 && e.code !== 18) continue;
    if (e.tSec < window.startSec || e.tSec > window.endSec) continue;
    if (bestEv === null || e.tSec > bestEv) bestEv = e.tSec;
  }
  if (bestEv !== null) {
    const start = Math.max(window.startSec, bestEv - EVENT_LEAD_SEC);
    const end = disarmSec !== null && disarmSec > start ? disarmSec : window.endSec;
    return {
      window: { startSec: start, endSec: end },
      basis: `EV 事件码 ${bestEv}（着陆完成）于 ${bestEv.toFixed(1)}s，取前 ${EVENT_LEAD_SEC}s 为起点，排除 ${start.toFixed(1)}–${end.toFixed(1)}s`,
      confidence: "event",
      disarmSec,
    };
  }

  // ③ CTUN.Alt 下降段（需要 disarm 作为终点锚点）
  if (disarmSec !== null) {
    const descent = descentStart(ctx, window, disarmSec);
    if (descent !== null) {
      return {
        window: { startSec: descent, endSec: disarmSec },
        basis: `CTUN.Alt 从 ${descent.toFixed(1)}s 起持续下降至 disarm（≥${DESCENT_MIN_M} m / ≥${DESCENT_MIN_SEC}s），排除 ${descent.toFixed(1)}–${disarmSec.toFixed(1)}s`,
        confidence: "descent",
        disarmSec,
      };
    }
    // ④ 兜底：disarm 前 N 秒（启发式，可信度最低，必须写明）
    const heuristicStart = Math.max(window.startSec, disarmSec - HEURISTIC_SEC);
    return {
      window: { startSec: heuristicStart, endSec: disarmSec },
      basis: `启发式兜底：无 MODE/EV/Alt 降落线索，按 disarm 前 ${HEURISTIC_SEC}s 近似（${heuristicStart.toFixed(1)}–${disarmSec.toFixed(1)}s），可信度低`,
      confidence: "heuristic",
      disarmSec,
    };
  }

  // ⑤ 识别不出来
  return {
    window: null,
    basis: "未识别出降落段：日志里没有 disarm 事件，也没有可用的 MODE/EV/Alt 线索，因此**未排除**任何区段",
    confidence: "unknown",
    disarmSec: null,
  };
}

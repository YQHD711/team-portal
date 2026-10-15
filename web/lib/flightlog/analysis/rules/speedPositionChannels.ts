/**
 * 速度/位置环的**通道表**（按机型分支的适用性定义）。
 *
 * 把"哪个机型看哪条消息、哪个列、用什么判据、门槛是多少"集中成数据表，
 * 规则主体只负责遍历 + 构造结论 —— 这样加通道不会复制粘贴判定代码。
 *
 * 实测依据（真实语料 66 Copter / 9 Plane / 1 Rover）：
 *  ① Plane **没有** PSCN/PSCE/PSCD（实测 0 条）→ 骨架式不适用，绝不能当整条规则门槛；
 *  ② `CTUN.AsT` **不是有效目标空速**（Plane 实测 AsT RMS 1.0–2.8 m/s vs 实际空速 6–22 m/s），
 *     真实对的目标/实际空速在 TECS `spdem`/`sp`（RMS 11–27 m/s）；
 *  ③ Rover 的 NTUN 是另一套列名（`WpDist/WpBrg/DesYaw/Yaw/XTrack`），横向偏差列叫 `XTrack` 而不是 `XT`。
 */

import type { Finding, Suggestion } from "../../types/report";
import { suggestion } from "../finding";
import { notApplicable } from "../trackingUnknowns";
import { SPEED_POSITION, metresFor } from "../thresholds";
import type { VehicleKind } from "../../types/log";

const PS = SPEED_POSITION;

export type ChannelMode = "ratio" | "absolute";

export interface Channel {
  subject: string;
  /** 消息名；目标/实际列成对，或给 deviationField（列本身就是偏差） */
  message: string;
  targetField?: string;
  actualField?: string;
  deviationField?: string;
  mode: ChannelMode;
  errorUnit: string;
  excitationUnit: string;
  /** ratio 模式 = 比值阈值；absolute 模式 = 绝对阈值（errorUnit） */
  warning: number;
  critical: number;
  /**
   * 激励门槛，**只给比值判据**（速度/空速的 误差/目标；比值在小分母下会放大）。
   * 位置/高度的米制判据是绝对量：30 m 的高度偏差与"目标速度多小"无关，
   * 用门槛挡掉它就是把最该看见的日志藏起来（Lead 裁决 2）→ 这些通道不传本字段。
   */
  minExcitation?: number;
  paramHint: string;
  /** 该机型本该有该通道：缺消息算 missing_required 而不是 insufficient_data */
  missingIsRequired: boolean;
  /** 缺列/缺消息时的说明（要求"说清为什么"，尤其是不能用别的字段顶替的情况） */
  missingDetail?: string;
}

/** Copter：PSC* 三个轴的 `TV*−V*` 速度环 + `TP*−P*` 位置环（垂向用高度阈值） */
export function copterChannels(kind: VehicleKind = "copter"): Channel[] {
  const channels: Channel[] = [];
  const position = metresFor(PS.positionM, kind);
  const altitude = metresFor(PS.altitudeM, kind);
  for (const [suffix, label] of [["N", "北向"], ["E", "东向"], ["D", "垂向"]] as const) {
    channels.push({
      subject: `速度环（${label}）`,
      message: `PSC${suffix}`,
      targetField: `TV${suffix}`,
      actualField: `V${suffix}`,
      mode: "ratio",
      errorUnit: "m/s",
      excitationUnit: "m/s",
      warning: PS.errRatioWarning,
      critical: PS.errRatioCritical,
      minExcitation: PS.minVelocityExcitationMps,
      paramHint: suffix === "D" ? "PSC_VELZ_P" : "PSC_VELXY_P",
      missingIsRequired: true,
    });
    const vertical = suffix === "D";
    const metres = vertical ? altitude : position;
    channels.push({
      subject: vertical ? "高度环（垂向位置）" : `位置环（${label}）`,
      message: `PSC${suffix}`,
      targetField: `TP${suffix}`,
      actualField: `P${suffix}`,
      mode: "absolute",
      errorUnit: "m",
      excitationUnit: "m/s",
      warning: metres.warnM,     // 按机型取（Copter 与 Plane 差两个数量级，见 thresholds.ts）
      critical: metres.critM,
      // 不传 minExcitation：绝对量判据不做激励门槛（裁决 2）
      paramHint: vertical ? "PSC_POSZ_P" : "PSC_POSXY_P",
      missingIsRequired: true,
    });
  }
  return channels;
}

/** Plane：TECS 空速环（比值）+ NTUN 横向/高度偏差（绝对米；偏差列目标恒 0） */
export function planeChannels(kind: VehicleKind = "plane"): Channel[] {
  const position = metresFor(PS.positionM, kind);
  const altitude = metresFor(PS.altitudeM, kind);
  return [
    {
      subject: "空速环", message: "TECS", targetField: "spdem", actualField: "sp",
      mode: "ratio", errorUnit: "m/s", excitationUnit: "m/s",
      warning: PS.errRatioWarning, critical: PS.errRatioCritical, minExcitation: PS.minVelocityExcitationMps,
      paramHint: "TECS_SPDWEIGHT / TECS_TIME_CONST", missingIsRequired: true,
      missingDetail: "日志中没有 TECS 消息，无法评估空速环（4.4 之前或未开日志时没有 TECS）；"
        + "CTUN.AsT 实测不是有效目标空速（9 份 Plane 日志 AsT RMS 仅 1.0–2.8 m/s，而实际空速 6–22 m/s），"
        + "不能用它顶替，故如实判无法判断",
    },
    {
      subject: "航迹横向偏差", message: "NTUN", deviationField: "XT",
      mode: "absolute", errorUnit: "m", excitationUnit: "m",
      warning: position.warnM, critical: position.critM,
      paramHint: "NAVL1_PERIOD", missingIsRequired: true,
    },
    {
      subject: "高度偏差", message: "NTUN", deviationField: "AltE",
      mode: "absolute", errorUnit: "m", excitationUnit: "m",
      warning: altitude.warnM, critical: altitude.critM,
      paramHint: "TECS_TIME_CONST", missingIsRequired: true,
    },
  ];
}

/**
 * Rover：只有 NTUN.XTrack（车辆版的列名与 Plane 的 XT 不同）。
 *
 * ⚠️ **rover 档缺失**：`SPEED_POSITION.positionM` 目前只收录 copter/plane/default，
 * 所以这里取到的是 `default` 5/15 m（不是 Copter 的 0.5/2）。语料里唯一一份 Rover 日志的
 * XTrack **恒为 0**（没飞航迹），无法标定 —— **不要凭感觉补一档**，
 * 等有带航迹的真实 Rover 日志再按分位数补，并把依据写进 thresholds.ts。
 */
export function roverChannels(kind: VehicleKind = "rover"): Channel[] {
  const position = metresFor(PS.positionM, kind);
  return [
    {
      subject: "航迹横向偏差", message: "NTUN", deviationField: "XTrack",
      mode: "absolute", errorUnit: "m", excitationUnit: "m",
      warning: position.warnM, critical: position.critM,
      paramHint: "ATC_STR_RAT_P", missingIsRequired: true,
    },
  ];
}

export function channelsFor(vehicleKind: VehicleKind): Channel[] {
  if (vehicleKind === "plane" || vehicleKind === "px4-fixedwing") return planeChannels(vehicleKind);
  if (vehicleKind === "rover") return roverChannels(vehicleKind);
  return copterChannels(vehicleKind);
}

export function suggestionsFor(channel: Channel): Suggestion[] {
  return [
    suggestion(1, "先按振动与滤波规则确认机械与滤波正常（前一步未验证不做后一步）"),
    suggestion(2, `检查${channel.subject}链路：风速、GPS/气压计一致性、重心与配平`),
    suggestion(3, `若数据链路正常，再按官方顺序调整 ${channel.paramHint}`, {
      verify: `${channel.subject}误差 RMS 下降 ≥30%`,
    }),
  ];
}

/** 该机型结构上没有的通道 → not_applicable（不是"缺数据"，更不是"通过"） */
export function structuralGaps(vehicleKind: VehicleKind): Finding[] {
  const gaps: Finding[] = [];
  const fixedWing = vehicleKind === "plane" || vehicleKind === "px4-fixedwing";
  if (vehicleKind === "rover") {
    gaps.push(
      notApplicable({
        ruleId: "speed_position_tracking", ruleTitle: "速度环 / 位置环跟踪", subject: "空速环",
        note: "地面车没有空速（没有 TECS/CTUN 空速数据），该通道不适用",
      }),
      notApplicable({
        ruleId: "speed_position_tracking", ruleTitle: "速度环 / 位置环跟踪", subject: "位置环（PSC）",
        note: "Rover 没有 PSCN/PSCE/PSCD 位置控制器逐项日志（实测 0 条），该通道不适用；"
          + "地面车的航迹跟踪由 NTUN.XTrack 评估",
      }),
    );
  }
  if (!fixedWing && vehicleKind !== "rover") {
    gaps.push(
      notApplicable({
        ruleId: "speed_position_tracking", ruleTitle: "速度环 / 位置环跟踪", subject: "空速环",
        note: "多旋翼没有空速（没有 TECS 空速数据），该通道不适用",
      }),
    );
  }
  if (fixedWing) {
    gaps.push(
      notApplicable({
        ruleId: "speed_position_tracking", ruleTitle: "速度环 / 位置环跟踪", subject: "速度环（PSC）",
        note: "固定翼没有 PSCN/PSCE/PSCD 位置控制器逐项日志（实测 0 条），不能把它当门槛；"
          + "固定翼用 TECS 空速 + NTUN 偏差评估",
      }),
    );
  }
  return gaps;
}

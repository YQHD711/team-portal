/**
 * 导航器/控制参数的可接受范围表（**参数规则的数据源**）。
 *
 * 设计纪律（用户明确要求）：
 *  - 队内调过参是常态，**非默认值不等于问题** —— 所以每条参数有一个很宽的 `ok` 区间：
 *    落在里面即使和默认值差很多也**不产生任何结论**；
 *  - 只有落在 `ok` 之外（明显不合理）才是 warning，越过 `danger` 才是 critical；
 *  - 每条参数都带官方文档链接与判据说明，保证"可审计"。
 *
 * 来源（ArduPilot 官方文档）：
 *  Plane 导航/横滚俯仰/偏航：https://ardupilot.org/plane/docs/parameters.html
 *  L1 导航：https://ardupilot.org/plane/docs/navigation-tuning.html
 *  TECS：https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html
 *  Copter PSC/WPNAV：https://ardupilot.org/copter/docs/parameters.html
 *  Copter 位置控制器调参：https://ardupilot.org/copter/docs/tuning-process-instructions.html
 */

import type { VehicleKind } from "../../types/log";

export interface ParamSpec {
  name: string;
  /** 适用的机型（同一参数名在不同机型上语义不同，必须按机型过滤） */
  kinds: readonly VehicleKind[];
  /** 官方默认值 */
  def: number;
  /** 合理区间（含端点）：界内一律不报 */
  ok: readonly [number, number];
  /** 危险端点：越界即 critical */
  danger: readonly [number, number];
  unit: string;
  doc: string;
  /** 判据说明（写进 evidence） */
  why: string;
  /**
   * 官方定义的**语义化特殊值**（哨兵）：例如 `NAVL1_LIM_BANK=0` 表示"沿用 LIM_ROLL_CD"，
   * `TECS_PITCH_MIN=0` 表示"不下压机头"。这些值必须放行，否则就是把合法配置当故障（误报）。
   */
  sentinels?: readonly { value: number; means: string }[];
}

const DOC_PLANE_NAV = "https://ardupilot.org/plane/docs/navigation-tuning.html";
const DOC_PLANE_PARAM = "https://ardupilot.org/plane/docs/parameters.html";
const DOC_TECS = "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html";
const DOC_COPTER_PARAM = "https://ardupilot.org/copter/docs/parameters.html";

const PLANE: readonly VehicleKind[] = ["plane"];
const COPTER: readonly VehicleKind[] = ["copter"];
const PLANE_FW: readonly VehicleKind[] = ["plane"];

/** Plane：L1 导航 + 姿态/偏航时间常数 + TECS 基本量 */
const PLANE_SPECS: readonly ParamSpec[] = [
  { name: "NAVL1_PERIOD", kinds: PLANE, def: 17, ok: [10, 25], danger: [8, 30], unit: "s", doc: DOC_PLANE_NAV, why: "L1 周期过小会来回摆（振荡），过大则航线跟随迟钝；官方建议 8~30，常规 10~25" },
  { name: "NAVL1_DAMPING", kinds: PLANE, def: 0.75, ok: [0.6, 0.9], danger: [0.45, 0.98], unit: "", doc: DOC_PLANE_NAV, why: "阻尼低于 0.45 会超调振荡，接近 1 变纯阻尼/迟钝" },
  { name: "NAVL1_XTRACK_I", kinds: PLANE, def: 0.02, ok: [0, 0.08], danger: [-0.001, 0.2], unit: "", doc: DOC_PLANE_NAV, why: "横向偏差积分项；过大在侧风下会积到振荡" },
  { name: "NAVL1_LIM_BANK", kinds: PLANE, def: 45, ok: [0, 60], danger: [-1, 70], unit: "deg", doc: DOC_PLANE_NAV,
    why: "航线导航允许的最大坡度；过小转弯半径失控，过大超出姿态能力",
    sentinels: [{ value: 0, means: "0 = 沿用 LIM_ROLL_CD 的坡度限制（官方定义，实测 9 份 Plane 日志全为 0）" }] },
  { name: "RLL2SRV_TCONST", kinds: PLANE, def: 0.5, ok: [0.3, 1], danger: [0.15, 1.5], unit: "s", doc: DOC_PLANE_PARAM, why: "横滚时间常数；过小抖动，过大横滚迟滞" },
  { name: "PTCH2SRV_TCONST", kinds: PLANE, def: 0.5, ok: [0.3, 1], danger: [0.15, 1.5], unit: "s", doc: DOC_PLANE_PARAM, why: "俯仰时间常数；同上" },
  { name: "PTCH2SRV_RLL", kinds: PLANE, def: 1, ok: [0.5, 1.6], danger: [0.2, 2.5], unit: "", doc: DOC_PLANE_PARAM, why: "横滚→俯仰混控量；偏离过多导致转弯掉高/爬升" },
  { name: "YAW2SRV_RLL", kinds: PLANE, def: 1, ok: [0.4, 1.5], danger: [0.1, 2.5], unit: "", doc: DOC_PLANE_PARAM, why: "转向时用偏航协调转弯的量；过大侧滑明显" },
  { name: "AHRS_RP_P", kinds: PLANE_FW, def: 0.2, ok: [0.1, 0.4], danger: [0.03, 0.8], unit: "", doc: DOC_PLANE_PARAM, why: "加速度计对姿态的修正权重；过小姿态漂移，过大受加速度干扰" },
  { name: "AHRS_YAW_P", kinds: PLANE_FW, def: 0.2, ok: [0.1, 0.4], danger: [0.03, 0.8], unit: "", doc: DOC_PLANE_PARAM, why: "磁罗盘对偏航的修正权重；同上" },
  { name: "TECS_CLMB_MAX", kinds: PLANE, def: 5, ok: [1, 15], danger: [0.5, 25], unit: "m/s", doc: DOC_TECS, why: "最大爬升率；过小遇地形无法爬升，过大超出动力/失速裕度" },
  { name: "TECS_SINK_MIN", kinds: PLANE, def: 2, ok: [0.8, 6], danger: [0.2, 10], unit: "m/s", doc: DOC_TECS, why: "最小下沉率（用于下滑）；过小下滑太慢" },
  { name: "TECS_SINK_MAX", kinds: PLANE, def: 5, ok: [1, 15], danger: [0.5, 30], unit: "m/s", doc: DOC_TECS, why: "最大下沉率；必须大于最小下沉率" },
  { name: "TECS_TIME_CONST", kinds: PLANE, def: 5, ok: [3, 8], danger: [1.5, 12], unit: "s", doc: DOC_TECS, why: "总能量控制器时间常数；过小油门/俯仰抖动，过大高度-速度响应慢" },
  { name: "TECS_SPDWEIGHT", kinds: PLANE, def: 1, ok: [0, 2], danger: [-0.01, 3], unit: "", doc: DOC_TECS, why: "速度/高度权重：0 只管高度，2 只管速度" },
  { name: "TECS_PITCH_MAX", kinds: PLANE, def: 20, ok: [10, 35], danger: [5, 45], unit: "deg", doc: DOC_TECS, why: "TECS 输出俯仰上限；过小爬升受限，过大易失速" },
  { name: "TECS_PITCH_MIN", kinds: PLANE, def: -20, ok: [-60, 0], danger: [-90, 1], unit: "deg", doc: DOC_TECS,
    why: "TECS 输出俯仰下限（负值低头）；官方允许 -90~0，0 表示不下压机头",
    sentinels: [{ value: 0, means: "0 = TECS 不下压机头（官方合法取值，实测部分 Plane 日志就是 0）" }] },
];

/** Copter：位置/速度/加速度控制器 + WPNAV 限幅 */
const COPTER_SPECS: readonly ParamSpec[] = [
  { name: "PSC_POSXY_P", kinds: COPTER, def: 1, ok: [0.5, 3], danger: [0.1, 6], unit: "", doc: DOC_COPTER_PARAM, why: "水平位置 P；过大位置抖动，过小抗风差" },
  { name: "PSC_VELXY_P", kinds: COPTER, def: 2, ok: [1, 4], danger: [0.3, 8], unit: "", doc: DOC_COPTER_PARAM, why: "水平速度 P；过大速度超调" },
  { name: "PSC_VELXY_I", kinds: COPTER, def: 1, ok: [0.3, 2], danger: [0.05, 4], unit: "", doc: DOC_COPTER_PARAM, why: "水平速度 I；过大在长距离飞行中积到振荡" },
  { name: "PSC_VELXY_D", kinds: COPTER, def: 0.5, ok: [0, 1.2], danger: [-0.01, 2.5], unit: "", doc: DOC_COPTER_PARAM, why: "水平速度 D；过大对振动敏感" },
  { name: "PSC_VELZ_P", kinds: COPTER, def: 5, ok: [2.5, 8], danger: [0.5, 15], unit: "", doc: DOC_COPTER_PARAM, why: "垂直速度 P；过大高度抖动" },
  { name: "PSC_ACCZ_P", kinds: COPTER, def: 0.5, ok: [0.2, 1.2], danger: [0.05, 2.5], unit: "", doc: DOC_COPTER_PARAM, why: "垂直加速度 P；过高油门抖动" },
  { name: "PSC_ACCZ_I", kinds: COPTER, def: 1, ok: [0.2, 2.5], danger: [0.05, 5], unit: "", doc: DOC_COPTER_PARAM, why: "垂直加速度 I；悬停油门学习相关" },
  { name: "WPNAV_SPEED", kinds: COPTER, def: 500, ok: [100, 2000], danger: [30, 3000], unit: "cm/s", doc: DOC_COPTER_PARAM, why: "自动模式水平速度上限；超过机架能力会失位" },
  { name: "WPNAV_ACCEL", kinds: COPTER, def: 100, ok: [50, 500], danger: [10, 1000], unit: "cm/s²", doc: DOC_COPTER_PARAM, why: "水平加速度上限；过大导致姿态超调" },
  { name: "WPNAV_RADIUS", kinds: COPTER, def: 200, ok: [10, 1000], danger: [1, 5000], unit: "cm", doc: DOC_COPTER_PARAM, why: "航点到达半径；过大切点早，过小在风里无法到点" },
  { name: "WPNAV_SPEED_UP", kinds: COPTER, def: 250, ok: [50, 600], danger: [10, 1000], unit: "cm/s", doc: DOC_COPTER_PARAM, why: "自动上升速度上限" },
  { name: "WPNAV_SPEED_DN", kinds: COPTER, def: 150, ok: [50, 600], danger: [10, 1000], unit: "cm/s", doc: DOC_COPTER_PARAM, why: "自动下降速度上限" },
];

export const NAV_PARAM_SPECS: readonly ParamSpec[] = [...PLANE_SPECS, ...COPTER_SPECS];

export type ParamVerdict = "ok" | "warning" | "critical";

export const clampToOk = (spec: ParamSpec, v: number): number =>
  v < spec.ok[0] ? spec.ok[0] : v > spec.ok[1] ? spec.ok[1] : v;

/** 判定单个参数值：只有越出 `ok` 才报警，越出 `danger` 才严重；官方哨兵值一律放行 */
export function classifyParam(spec: ParamSpec, value: number): ParamVerdict {
  if (!Number.isFinite(value)) return "warning";
  if (spec.sentinels?.some(s => Math.abs(value - s.value) < 1e-9)) return "ok";
  if (value < spec.danger[0] || value > spec.danger[1]) return "critical";
  if (value < spec.ok[0] || value > spec.ok[1]) return "warning";
  return "ok";
}

/** 交叉检查（不依赖单参数范围，只看相互关系）：返回问题描述或 null */
export function crossCheckParams(get: (name: string) => number | null): string | null {
  const sinkMin = get("TECS_SINK_MIN");
  const sinkMax = get("TECS_SINK_MAX");
  if (sinkMin !== null && sinkMax !== null && sinkMax <= sinkMin) {
    return `TECS_SINK_MAX(${sinkMax}) 必须大于 TECS_SINK_MIN(${sinkMin})，否则下滑段无法建立能量平衡`;
  }
  const pitchMin = get("TECS_PITCH_MIN");
  const pitchMax = get("TECS_PITCH_MAX");
  if (pitchMin !== null && pitchMax !== null && pitchMax <= pitchMin) {
    return `TECS_PITCH_MAX(${pitchMax}) 必须大于 TECS_PITCH_MIN(${pitchMin})`;
  }
  return null;
}

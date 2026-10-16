/**
 * PX4 角度环图表的信号定义（从 px4AttitudeLoop.ts 拆出：原文件超过 200 行）。
 *
 * ⚠️ 这里就是 task-34 修掉的那个 bug 的现场：图上必须显示**物理量**——
 *  - 指令 `vehicle_attitude_setpoint.roll_body` 等是**弧度** → `rad-to-deg`
 *  - 实际姿态是**四元数** `q[0..3]` → `euler-from-quaternion`（与指标同一份 `quatToEulerDeg`）
 * 直接画 `q[0]`（w 分量）会让两条线量纲完全不同：平飞时 q0≈0.7 而滚转角≈0°，
 * 看起来像"跟踪极差"（用户截图就是这个现象）。
 */

import type { ChartRequest } from "../../../types/report";
import type { TimeWindow } from "../../../types/log";
import type { Px4AngleAxis } from "./px4AnglePair";

export const PX4_ATT_RULE_ID_FOR_CHART = "px4_attitude_tracking";

const TARGET_FIELD: Readonly<Record<Px4AngleAxis, string>> = {
  roll: "roll_body",
  pitch: "pitch_body",
  yaw: "yaw_body",
};

export function px4AngleChart(ruleId: string, axis: Px4AngleAxis, label: string, window: TimeWindow): ChartRequest {
  return {
    id: `${ruleId}-${axis}`,
    kind: "timeseries",
    title: `${label} 角度环：指令 / 实际（度）`,
    signals: [
      {
        series: "vehicle_attitude_setpoint",
        field: TARGET_FIELD[axis],
        label: "指令（度）",
        derive: { kind: "rad-to-deg" },
      },
      {
        series: "vehicle_attitude",
        field: "q[0]",
        label: "实际（度，由 q[0..3] 转欧拉角）",
        derive: { kind: "euler-from-quaternion", axis, quatFields: ["q[0]", "q[1]", "q[2]", "q[3]"] },
      },
    ],
    window,
    thresholds: [],
    peakMarkers: [],
    highlightWindow: null,
    spectrum: null,
  };
}

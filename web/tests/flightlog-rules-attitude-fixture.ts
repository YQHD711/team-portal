/**
 * 角度环规则测试的合成文档构造器（非 *.test.ts，不会被 vitest 收集）。
 *
 * 目标与实际用**不同频率**的正弦：误差不会与指令同相，避免"误差被指令抵消"的假象；
 * 正弦幅值 → RMS 的换算是 幅值/√2，测试据此与阈值常量解耦（见测试文件里的 limits()）。
 */

import type { LogDocument, Series, VehicleKind } from "@/lib/flightlog/types/log";
import { makeDoc, makeSeries, sineWave, uniformTime } from "./helpers/flightlogFixture";

export const ATT_DT = 0.1;
export const ATT_N = 600;

export interface AxisInit {
  desAmp: number;
  errAmp: number;
}

export function attDoc(init: {
  vehicleKind?: VehicleKind;
  roll?: AxisInit;
  pitch?: AxisInit;
  yaw?: AxisInit;
  /** 实际航向整体偏移（度）——用于构造"跨 0/360"的环绕场景（359° ≡ −1°） */
  yawOffsetDeg?: number;
  count?: number;
  omitFields?: readonly string[];
}): LogDocument {
  const count = init.count ?? ATT_N;
  const fields: Record<string, number[]> = {};
  const axis = (name: string, spec: AxisInit | undefined, base: number, offset = 0): void => {
    if (!spec) return;
    const des = sineWave(count, ATT_DT, 0.2, spec.desAmp).map((v) => v + base);
    const err = sineWave(count, ATT_DT, 2.5, spec.errAmp);
    fields[`Des${name}`] = des;
    fields[name] = des.map((v, i) => v - err[i] + offset);
  };
  axis("Roll", init.roll, 0);
  axis("Pitch", init.pitch, 0);
  axis("Yaw", init.yaw, 90, init.yawOffsetDeg ?? 0);
  if (init.omitFields) for (const key of init.omitFields) delete fields[key];

  const series: Series[] = [makeSeries("ATT", 0, uniformTime(count, ATT_DT), fields)];
  return makeDoc({
    vehicleKind: init.vehicleKind ?? "copter",
    series,
    durationSec: count * ATT_DT,
  });
}

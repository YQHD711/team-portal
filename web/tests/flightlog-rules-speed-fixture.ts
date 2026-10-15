/**
 * 速度/位置环规则测试的合成文档构造器（非 *.test.ts，不会被 vitest 收集）。
 *
 * 米制阈值**按机型分档**（Copter 0.5/2 m 与 Plane 20/45 m 相差两个数量级），
 * 所以这里按机型取表再把幅值折算成"警告档/严重档"，测试不写死数字。
 */

import { SPEED_POSITION, metresFor } from "@/lib/flightlog/analysis/thresholds";
import type { LogDocument, Series } from "@/lib/flightlog/types/log";
import { constant, makeDoc, makeSeries, sineWave, uniformTime } from "./helpers/flightlogFixture";

export const SPEED_DT = 0.1;
export const SPEED_N = 600;
export const SPEED_DURATION = SPEED_N * SPEED_DT;
export const SQRT2 = Math.SQRT2;

/** 目标速度 RMS 取门槛的 4 倍（悬停取 0.2 倍）→ 与阈值数值解耦 */
export const FAST = SPEED_POSITION.minVelocityExcitationMps * 4 * SQRT2;
export const SLOW = SPEED_POSITION.minVelocityExcitationMps * 0.2 * SQRT2;
/** Plane 巡航空速约 15 m/s（实测语料 6–27 m/s），空速误差按该基准给 */
export const CRUISE = 15;
export const WARN_RATIO_ERR = (SPEED_POSITION.errRatioWarning + SPEED_POSITION.errRatioCritical) / 2;

export const COPTER_POS = metresFor(SPEED_POSITION.positionM, "copter");
export const COPTER_ALT = metresFor(SPEED_POSITION.altitudeM, "copter");
export const PLANE_POS = metresFor(SPEED_POSITION.positionM, "plane");
export const PLANE_ALT = metresFor(SPEED_POSITION.altitudeM, "plane");
export const POS_OK = COPTER_POS.warnM / 4;

/** Copter：PSC* 的目标/实际速度 + 目标/实际位置 */
export function copterDoc(opts: { targetAmp?: number; velErrAmp?: number; posErrAmp?: number; count?: number } = {}): LogDocument {
  const count = opts.count ?? SPEED_N;
  const target = opts.targetAmp ?? FAST;
  const velErr = opts.velErrAmp ?? 0.01;
  const posErr = opts.posErrAmp ?? POS_OK;
  const series: Series[] = (["N", "E", "D"] as const).map((s) => {
    const tv = sineWave(count, SPEED_DT, 0.2, target);
    const err = sineWave(count, SPEED_DT, 2.5, velErr);
    const tp = sineWave(count, SPEED_DT, 0.05, 50);
    const perr = sineWave(count, SPEED_DT, 1.7, posErr);
    return makeSeries(`PSC${s}`, 0, uniformTime(count, SPEED_DT), {
      [`TV${s}`]: tv,
      [`V${s}`]: tv.map((v, i) => v - err[i]),
      [`TP${s}`]: tp,
      [`P${s}`]: tp.map((v, i) => v - perr[i]),
    });
  });
  return makeDoc({ vehicleKind: "copter", series, durationSec: count * SPEED_DT });
}

/** Plane：TECS 空速 + NTUN 偏差；CTUN.AsT 故意记成 ≈1（真实日志如此，不能当目标空速） */
export function planeDoc(opts: { tecs?: boolean; xtAmp?: number; altAmp?: number; airspeedErrMps?: number } = {}): LogDocument {
  const series: Series[] = [];
  if (opts.tecs !== false) {
    const spdem = sineWave(SPEED_N, SPEED_DT, 0.1, 3).map((v) => v + CRUISE);
    const err = sineWave(SPEED_N, SPEED_DT, 2.5, opts.airspeedErrMps ?? 0.05);
    series.push(makeSeries("TECS", 0, uniformTime(SPEED_N, SPEED_DT), {
      spdem,
      sp: spdem.map((v, i) => v - err[i]),
    }));
  }
  series.push(makeSeries("NTUN", 0, uniformTime(SPEED_N, SPEED_DT), {
    XT: sineWave(SPEED_N, SPEED_DT, 0.1, opts.xtAmp ?? POS_OK),
    AltE: sineWave(SPEED_N, SPEED_DT, 0.1, opts.altAmp ?? PLANE_ALT.warnM / 4),
  }));
  series.push(makeSeries("CTUN", 0, uniformTime(SPEED_N, SPEED_DT), {
    AsT: constant(SPEED_N, 1),
    As: sineWave(SPEED_N, SPEED_DT, 0.1, CRUISE),
  }));
  return makeDoc({ vehicleKind: "plane", vehicle: "ArduPlane", series, durationSec: SPEED_N * SPEED_DT });
}

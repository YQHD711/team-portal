/**
 * 频谱/FFT 数学层验证。
 *
 * 为什么必须单独测：诊断结论依赖 FFT，但 FFT 写错时"图看起来正常"、
 * 只在特定样本数下出错。这里用**已知频率的合成信号**做正向对照，
 * 用白噪声做负向对照（主峰占比必须低）。
 */

import { describe, expect, it } from "vitest";
import { fftInPlace, nextPowerOfTwo } from "@/lib/flightlog/analysis/fft";
import { computeSpectrum, resampleUniform } from "@/lib/flightlog/analysis/spectrum";
import { uniformTime, sineWave, noise, constant } from "./helpers/flightlogFixture";

describe("fft", () => {
  it("DFT 与朴素实现的单频结果一致", () => {
    const n = 16;
    const re = Float64Array.from(sineWave(n, 1 / n, 3, 1));
    const im = new Float64Array(n);
    fftInPlace(re, im);
    // 朴素 DFT 对照
    const src = sineWave(n, 1 / n, 3, 1);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        const ang = (-2 * Math.PI * k * t) / n;
        sr += src[t] * Math.cos(ang);
        si += src[t] * Math.sin(ang);
      }
      expect(re[k]).toBeCloseTo(sr, 6);
      expect(im[k]).toBeCloseTo(si, 6);
    }
  });

  it("nextPowerOfTwo 非 2 的幂时向上取整", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4096)).toBe(4096);
    expect(nextPowerOfTwo(4097)).toBe(8192);
  });
});

describe("resampleUniform", () => {
  it("抖动时间轴被插值到均匀网格", () => {
    const count = 400;
    const time: number[] = [];
    const values: number[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      time.push(t);
      values.push(i);
      // 围绕标称 10 ms 的小幅抖动（真实日志的抖动远小于此）
      t += 0.01 + ((i % 5) - 2) * 0.0002;
    }
    const uni = resampleUniform(Float64Array.from(time), Float64Array.from(values));
    expect(uni).not.toBeNull();
    expect(uni!.sampleRateHz).toBeCloseTo(100, 0);
    expect(uni!.jitterRatio).toBeGreaterThan(1);
  });

  it("存在丢包（大间隙）时采样率由中位间隔决定，不被间隙拉偏", () => {
    const time = [0, 0.1, 0.2, 0.3, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7];
    const values = time.map((_, i) => i);
    const uni = resampleUniform(Float64Array.from(time), Float64Array.from(values));
    expect(uni).not.toBeNull();
    // 若用平均间隔会得到 ~0.245 s（4 Hz），中位间隔给出正确的 10 Hz
    expect(uni!.sampleRateHz).toBeCloseTo(10, 0);
  });

  it("时间戳退化时返回 null 而不是给出错误频谱", () => {
    const time = constant(100, 5);
    const values = constant(100, 1);
    expect(
      resampleUniform(Float64Array.from(time), Float64Array.from(values)),
    ).toBeNull();
  });
});

describe("computeSpectrum", () => {
  const dt = 0.01; // 100 Hz
  const count = 4096;

  it("能准确定位 2 Hz 主峰", () => {
    const s = computeSpectrum(
      Float64Array.from(uniformTime(count, dt)),
      Float64Array.from(sineWave(count, dt, 2, 1)),
      { minHz: 0.5, maxHz: 20 },
    );
    expect(s).not.toBeNull();
    expect(s!.peakHz).toBeCloseTo(2, 1);
    expect(s!.peakShare).toBeGreaterThan(0.5);
  });

  it("样本足够时也能准确定位 6.2 Hz 主峰", () => {
    const s = computeSpectrum(
      Float64Array.from(uniformTime(count, dt)),
      Float64Array.from(sineWave(count, dt, 6.2, 1)),
      { minHz: 0.5, maxHz: 20 },
    );
    expect(s!.peakHz).toBeCloseTo(6.2, 1);
  });

  it("负向对照：白噪声的主峰占比必须很低", () => {
    const s = computeSpectrum(
      Float64Array.from(uniformTime(count, dt)),
      Float64Array.from(noise(count, 1, 7)),
      { minHz: 0.5, maxHz: 20 },
    );
    expect(s).not.toBeNull();
    expect(s!.peakShare).toBeLessThan(0.05);
  });

  it("10 Hz 记录率下无法观测 6.2 Hz（Nyquist=5Hz）——这正是方案 v2 的硬伤", () => {
    const slowDt = 0.1; // 10 Hz
    const slow = computeSpectrum(
      Float64Array.from(uniformTime(1024, slowDt)),
      Float64Array.from(sineWave(1024, slowDt, 6.2, 1)),
      { minHz: 0.2, maxHz: 4.9 },
    );
    // 6.2 Hz 混叠到 3.8 Hz，工具只能看到错位的频率，绝不能据此下结论
    expect(slow!.peakHz).toBeGreaterThan(3.5);
    expect(slow!.peakHz).toBeLessThan(4.2);
    expect(slow!.peakHz).not.toBeCloseTo(6.2, 1);
  });
});

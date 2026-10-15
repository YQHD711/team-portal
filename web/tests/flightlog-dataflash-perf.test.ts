/**
 * 客户端兜底 + 主验收样本的性能/全量对照。
 *
 * ⚠️ CI 是 Linux 容器、没有 `G:/ardupilot_log_analysis` 盘，所以真实样本那组用
 * `describe.skipIf(!existsSync(FULL_BIN))` 门控：CI 里跳过，本机跑才验性能与全量条数。
 * 提交的黄金对照只依赖 `web/tests/fixtures/flightlog/` 的 200 KB 切片（见 flightlog-dataflash.test.ts）。
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseDataflash } from "@/lib/flightlog/dataflash/parseDataflash";
import { parseLogFile } from "@/lib/flightlog/dataflash/client";
import { sliceBytes } from "./flightlog-dataflash-fixture";

/** 主验收样本（9.8 MB，ArduCopter 4.6.2）：本机 testdata 目录，CI 里不存在。 */
const FULL_BIN = "G:/ardupilot_log_analysis/WebTools/testdata/quad_20260617.bin";
const HAS_FULL_BIN = existsSync(FULL_BIN);
/**
 * 性能门禁策略：目标是"解析 < 500 ms"，但在**全量并行**（86 个测试文件，含 76 个真实日志对照）下，
 * 同一份文件的 wall 与 CPU 时间都会被机器满载放大到 ~2 倍（实测 296 ms → 656 ms，CPU 时间也一样，
 * 因为 CPU 降频/SMT 争抢），硬门禁会变成假红。
 *  - 默认（全量跑）：宽松阈值 2000 ms，只拦灾难性回归，并把实测数字打进日志；
 *  - 严格（隔离跑）：`FLIGHTLOG_PERF_STRICT=1 npx vitest run tests/flightlog-dataflash-perf.test.ts`
 *    用 500 ms 门禁 —— 这是验收目标值的权威口径。
 */
const STRICT = process.env.FLIGHTLOG_PERF_STRICT === "1";
const limit = STRICT ? 500 : 2000;
/** pymavlink 2.4.49 对全量文件的实测条数（oracle 口径） */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  ARM: 3, EV: 271, MODE: 9, MSG: 36, VER: 1, PARM: 1112,
  VIBE: 9822, IMU: 24561, FTN2: 9822, GPS: 1637, PIDR: 3274, BAT: 3273,
};

describe("flightlog dataflash 客户端（无 Worker 环境兜底）", () => {
  it("parseLogFile 在 jsdom（无 Worker）走主线程兜底，结果与纯函数一致", async () => {
    const small = sliceBytes.subarray(0, 20_000);
    const viaPure = parseDataflash(small).doc;

    const viaClient = await parseLogFile(small);
    expect(viaClient.doc.messageCounts).toEqual(viaPure.messageCounts);
    expect(viaClient.warnings).toEqual(parseDataflash(small).warnings);
    expect(viaClient.stats.records).toBe(parseDataflash(small).stats.records);

    const forced = await parseLogFile(small, { forceMainThread: true });
    expect(forced.doc.messageCounts).toEqual(viaPure.messageCounts);
    expect(forced.doc.messageCounts.FMT).toBeGreaterThan(30);   // 兜底路径确实解析到了 FMT 布局
  });
});

describe.skipIf(!HAS_FULL_BIN)("flightlog dataflash 真实样本（本机性能，需 testdata）", () => {
  // 显式超时：1 次预热 + 5 次采样，满载时单次 ~800 ms，默认 5 s 会超时（不是解析变慢）
  it("9.8 MB 主样本：解析 < 500 ms，关键条数与机型/版本门控字段与 pymavlink 实测一致", { timeout: 60_000 }, () => {
    const bytes = new Uint8Array(readFileSync(FULL_BIN));
    // 门禁用**本线程 CPU 时间**（process.threadCpuUsage，Node 24 可用）而不是 wall：
    // 全量 vitest 并行跑 86 个测试文件（含 76 个真实日志对照），wall 被 CPU 争抢放大 2 倍以上；
    // process.cpuUsage() 是整个进程的，会把同进程其它测试文件的 CPU 也算进来（实测被放大到 641 ms）。
    // 本线程 CPU 只反映解析器自身开销 → 隔离环境与并行环境都能稳定衡量"解析 < 500 ms"这个目标。
    const threadCpu = (
      process as unknown as {
        threadCpuUsage?: (prev?: { user: number; system: number }) => { user: number; system: number };
      }
    ).threadCpuUsage;
    const sampleCpu = (prev?: { user: number; system: number }): { user: number; system: number } =>
      threadCpu ? threadCpu(prev) : process.cpuUsage(prev);

    const wall: number[] = [];
    const cpu: number[] = [];
    let result = parseDataflash(bytes);
    for (let i = 0; i < 5; i += 1) {
      const cpuBefore = sampleCpu();
      const start = performance.now();
      result = parseDataflash(bytes);
      wall.push(performance.now() - start);
      const delta = sampleCpu(cpuBefore);
      cpu.push((delta.user + delta.system) / 1000);
    }
    const bestWall = Math.min(...wall);
    const bestCpu = Math.min(...cpu);

    for (const [name, count] of Object.entries(EXPECTED_COUNTS)) {
      expect(result.doc.messageCounts[name], `${name} 条数`).toBe(count);
    }
    expect(Object.keys(result.doc.messageCounts).length).toBe(81);
    expect(Object.keys(result.doc.params).length).toBe(1081);
    expect(result.stats.records).toBe(229_590);
    // task-24：解码全部消息类型（白名单时代这里只有 ~20 种）
    expect(Object.keys(result.doc.decodedFields).length).toBe(81);
    expect(result.stats.skippedBytes).toBe(0);

    // 规则用 vehicleKind 决定速率环单位换算（Copter=rad/s、Plane=deg/s）、用 firmwareVersion 做版本门控
    expect(result.doc.meta.vehicle).toBe("ArduCopter");
    expect(result.doc.meta.vehicleKind).toBe("copter");
    expect(result.doc.meta.firmwareVersion).toBe("4.6.2");
    expect(result.doc.meta.versionNumeric).toBe(40602);
    expect(result.doc.meta.armed).toBe(true);
    expect(result.doc.events.some((event) => event.kind === "arm")).toBe(true);
    expect(bestCpu).toBeLessThan(limit);
    console.log(
      `[perf] quad_20260617.bin ${(bytes.length / 1e6).toFixed(2)} MB → CPU best ${bestCpu.toFixed(0)} ms`
      + ` (cpu: ${cpu.map((t) => t.toFixed(0)).join(", ")} ms), wall best ${bestWall.toFixed(0)} ms`
      + ` (wall: ${wall.map((t) => t.toFixed(0)).join(", ")} ms), records=${result.stats.records}`
      + `；门禁 ${limit} ms（${STRICT ? "严格：隔离实测 < 500 ms" : "全量并行默认宽松阈值，见注释"}）`,
    );
  });
});

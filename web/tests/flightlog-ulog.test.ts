/**
 * PX4 ULog 解析器单测（不依赖真实日志：字节由 `flightlog-ulog-fixture.ts` 合成）。
 *
 * 覆盖：自描述格式表（数组/嵌套/char/padding）、多实例、参数与信息（**信息键是长度前缀**）、
 * 事件（actuator_armed 跳变 + 日志字符串）、时间轴换算、四元数→欧拉角、
 * 以及负向对照（空文件/坏魔术/截断/未知不兼容标志/未订阅数据/无 timestamp）。
 */

import { describe, expect, it } from "vitest";

import { parseUlog, looksLikeUlog } from "@/lib/flightlog/ulog/parseUlog";
import { flattenFormat, parseFormatString, TYPE_INFO } from "@/lib/flightlog/ulog/ulogFormat";
import { quatToEulerDeg, wrap180Deg } from "@/lib/flightlog/ulog/quaternion";
import { sniffFormat } from "@/lib/flightlog/runDiagnosis";
import { buildUlog, minimalUlog, ULOG_MAGIC } from "./flightlog-ulog-fixture";

describe("ULog 自描述格式表", () => {
  it("按格式串泛化解析：数组、嵌套类型、char、末尾 _padding 剔除", () => {
    const format = parseFormatString(new TextEncoder().encode("s:uint64_t timestamp;float[3] xyz;uint8_t _padding0"));
    expect(format.name).toBe("s");
    expect(format.fields).toEqual([
      { name: "timestamp", type: "uint64_t", arraySize: 0 },
      { name: "xyz", type: "float", arraySize: 3 },
      { name: "_padding0", type: "uint8_t", arraySize: 0 },
    ]);

    const formats = new Map([
      ["outer", parseFormatString(new TextEncoder().encode("outer:uint64_t timestamp;inner_t inner;int32_t n"))],
      ["inner_t", parseFormatString(new TextEncoder().encode("inner_t:float a;float b"))],
    ]);
    const flat = flattenFormat(formats.get("outer")!, formats);
    expect(flat.map((f) => f.name)).toEqual(["timestamp", "inner.a", "inner.b", "n"]);
    expect(TYPE_INFO.char.numeric).toBe(true);
  });

  it("数组按 `q[i]` 展开，可按名取值（延续 DataFlash 的列名约定）", () => {
    const bytes = minimalUlog();
    const { doc } = parseUlog(bytes);
    const va = doc.series["vehicle_attitude:0"];
    expect(Object.keys(va.fields)).toEqual(["q[0]", "q[1]", "q[2]", "q[3]"]);
    expect(va.fields["q[2]"][0]).toBe(0);
  });
});

describe("ULog 解析：多实例 / 参数 / 信息 / 事件 / 时间轴", () => {
  const result = parseUlog(minimalUlog());

  it("多实例 topic 按 `NAME:instance` 分开（对齐 DataFlash 的 IMU0/1/2）", () => {
    expect(Object.keys(result.doc.series)).toContain("sensor_gyro:0");
    expect(Object.keys(result.doc.series)).toContain("sensor_gyro:1");
    expect(result.doc.series["sensor_gyro:1"].instance).toBe(1);
    expect(Array.from(result.doc.series["sensor_gyro:1"].fields["xyz[0]"])).toEqual([11]);
    // 按名汇总的记录数（实例相加）
    expect(result.doc.messageCounts.sensor_gyro).toBe(2);
    expect(result.datasets.filter((d) => d.name === "sensor_gyro")).toHaveLength(2);
  });

  it("参数与信息：信息键是**长度前缀**而不是 NUL 结尾（曾把 key 与 value 粘在一起）", () => {
    expect(result.doc.params.ATC_RAT_RLL_P).toBeCloseTo(0.15, 6);
    expect(result.info.get("ver_sw_release")).toBe(0x010d07ff);
    expect(result.info.get("ver_hw")).toBe("V6C21");
    expect(result.info.get("sys_name")).toBe("PX4");
    // 固件版本按 pyulog 位定义拆：1.13.7（type=255 → 正式版）
    expect(result.doc.meta.firmwareVersion).toBe("1.13.7");
    expect(result.doc.meta.firmwareString).toBe("PX4 v1.13.7");
    expect(result.doc.meta.board).toBe("V6C21");
    expect(result.doc.meta.platform).toBe("px4");
  });

  it("时间轴统一成相对秒（µs → s），并统计时长", () => {
    expect(result.stats.t0us).toBe(1_000_000);
    expect(result.doc.series["actuator_armed:0"].timeSec[1]).toBeCloseTo(0.1, 9);
    expect(result.doc.meta.durationSec).toBeCloseTo(0.1, 6);
  });

  it("事件：actuator_armed 跳变 → arm/disarm，L 字符串 → info 事件", () => {
    const kinds = result.doc.events.map((e) => e.kind);
    expect(kinds).toContain("arm");
    expect(result.doc.events.find((e) => e.kind === "arm")?.tSec).toBeCloseTo(0.1, 9);
    expect(result.doc.events.some((e) => e.kind === "info" && e.label.includes("armed by RC"))).toBe(true);
    expect(result.doc.meta.armed).toBe(true);
    expect(result.doc.series["gps:0"].fields["tag[0]"][0]).toBe("A".charCodeAt(0));
  });

  it("覆盖度：出现过的 topic 都有解码字段清单（只计数没解码必须能被发现）", () => {
    for (const topic of Object.keys(result.doc.messageCounts)) {
      expect(result.doc.decodedFields[topic], `${topic} 缺少字段清单`).toBeDefined();
    }
    expect(result.warnings).toEqual([]);
  });
});

describe("ULog 负向对照（不许静默）", () => {
  it("空文件 / 坏魔术：给出可读原因", () => {
    expect(() => parseUlog(new Uint8Array(0))).toThrow(/不是 ULog 文件.*长度/);
    const bad = new Uint8Array(32).fill(0x41);
    expect(() => parseUlog(bad)).toThrow(/魔术不匹配/);
    expect(looksLikeUlog(bad)).toBe(false);
    expect(looksLikeUlog(new Uint8Array(ULOG_MAGIC))).toBe(false); // 只有 7 字节，不足 16
  });

  it("截断：尾部不完整必须写警告并计入 truncatedBytes（不是静默丢弃）", () => {
    const full = minimalUlog();
    const cut = full.slice(0, full.length - 6);
    const { doc, stats, warnings } = parseUlog(cut);
    expect(stats.truncatedBytes).toBeGreaterThan(0);
    expect(stats.truncatedBytes).toBeLessThanOrEqual(30);
    expect(warnings.some((w) => w.includes("截断"))).toBe(true);
    // 被切掉的正是末尾的日志字符串消息 → 它不应出现，而数据记录仍在
    expect(doc.events.some((e) => e.label.includes("armed by RC"))).toBe(false);
    expect(stats.records).toBe(7);
  });

  it("截断到数据记录中间：记录数减少，但必须显式警告", () => {
    const cut = minimalUlog().slice(0, minimalUlog().length - 60);
    const { doc, stats, warnings } = parseUlog(cut);
    expect(stats.truncatedBytes).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("截断"))).toBe(true);
    expect(doc.series["gps:0"]).toBeUndefined();
  });

  it("未知不兼容标志：拒绝解析，不给可能错误的诊断", () => {
    const bytes = buildUlog({
      formats: ["t:uint64_t timestamp;float v"],
      subscriptions: [{ name: "t", msgId: 1 }],
      recordTypes: { 1: ["uint64_t", "float"] },
      records: [{ msgId: 1, values: [1_000_000, 1] }],
      incompatFlag: true,
    });
    expect(() => parseUlog(bytes)).toThrow(/不兼容标志/);
  });

  it("未订阅的数据 / 未知消息类型 / 无 timestamp：跳过但必须写进 warnings", () => {
    const bytes = buildUlog({
      formats: ["t:uint64_t timestamp;float v", "no_ts:float v"],
      subscriptions: [{ name: "t", msgId: 1 }, { name: "no_ts", msgId: 2 }],
      recordTypes: { 1: ["uint64_t", "float"], 2: ["float"] },
      records: [
        { msgId: 2, values: [1.5] },
        { msgId: 9, values: [7] },
        { msgId: 1, values: [1_000_000, 2] },
      ],
      rawMessages: [{ type: "Z", payload: [1, 2, 3, 4] }],
    });
    const { doc, warnings } = parseUlog(bytes);
    expect(doc.messageCounts.no_ts).toBe(1);
    expect(warnings.some((w) => w.includes("没有 timestamp 字段"))).toBe(true);
    expect(warnings.some((w) => w.includes("未订阅的 msg_id=9"))).toBe(true);
    expect(warnings.some((w) => w.includes("未知消息类型") && w.includes("Z×1"))).toBe(true);
    expect(doc.series["t:0"].fields.v[0]).toBe(2);
  });
});

describe("四元数 → 欧拉角（PX4 姿态的基础换算）", () => {
  const near = (a: number, b: number, tol = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(tol);
  const nearZero = (e: { roll: number; pitch: number; yaw: number }): void => {
    near(e.roll, 0); near(e.pitch, 0); near(e.yaw, 0);
  };

  it("单位四元数与 q ≡ -q 表示同一姿态", () => {
    nearZero(quatToEulerDeg(1, 0, 0, 0));
    nearZero(quatToEulerDeg(-1, 0, 0, 0));
  });

  it("绕 Z 轴 90° / 绕 X 轴 30°：与解析式一致", () => {
    const half = Math.SQRT1_2;
    const yaw90 = quatToEulerDeg(half, 0, 0, half);
    near(yaw90.yaw, 90, 1e-9);
    near(yaw90.roll, 0);
    const roll30 = quatToEulerDeg(Math.cos(Math.PI / 12), Math.sin(Math.PI / 12), 0, 0);
    near(roll30.roll, 30, 1e-9);
    near(roll30.yaw, 0);
  });

  it("yaw 归一到 ±180°：185° → -175°，-179.9/179.9 不跳变", () => {
    const half = Math.SQRT1_2;
    // 绕 Z 轴 185°：q = (cos(92.5°), 0, 0, sin(92.5°))
    const angle = (185 * Math.PI) / 180;
    const q = quatToEulerDeg(Math.cos(angle / 2), 0, 0, Math.sin(angle / 2));
    near(q.yaw, -175, 1e-9);
    near(wrap180Deg(179.9), 179.9);
    near(wrap180Deg(-179.9), -179.9);
    near(wrap180Deg(360), 0);
    near(wrap180Deg(-180), -180);
  });

  it("非有限 / 零模长：返回 NaN 而不是伪装成 0", () => {
    expect(Number.isNaN(quatToEulerDeg(0, 0, 0, 0).roll)).toBe(true);
    expect(Number.isNaN(quatToEulerDeg(Number.NaN, 0, 0, 0).yaw)).toBe(true);
    expect(Number.isNaN(wrap180Deg(Number.NaN))).toBe(true);
  });
});

describe("按格式路由的内容嗅探", () => {
  it("ULog 魔术头 / DataFlash 0xA3 0x95 / 未知格式", () => {
    expect(sniffFormat(new Uint8Array(ULOG_MAGIC))).toBe("ulog");
    expect(sniffFormat(new Uint8Array([0xa3, 0x95, 0, 0]))).toBe("dataflash");
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

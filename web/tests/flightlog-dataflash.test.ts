/**
 * DataFlash 解析器与 pymavlink 的**黄金对照**（同一段字节逐字段比对）。
 *
 * 黄金数据：`tools/flightlog_pymavlink_dump.py`（pymavlink 2.4.49）对
 * `web/tests/fixtures/flightlog/quad_20260617_head200k.bin`（真实日志的字节精确前缀）生成。
 * 明确不做"看起来对"：字段名、条数、单位、数值（浮点容差）逐项断言。
 * 负向对照见 flightlog-dataflash-negative.test.ts，性能/真实样本见 flightlog-dataflash-perf.test.ts。
 */

import { describe, expect, it } from "vitest";

import { parseDataflash } from "@/lib/flightlog/dataflash/parseDataflash";
import { buildLayout, parseFormatHeader } from "@/lib/flightlog/dataflash/fmtLayout";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { closeEnough, golden, sliceBytes } from "./flightlog-dataflash-fixture";

const parsed = parseDataflash(sliceBytes);
const doc: LogDocument = parsed.doc;

describe("flightlog dataflash 切片黄金对照（pymavlink 2.4.49）", () => {
  it("切片本身是真实日志的字节精确前缀，且 pymavlink 能独立解析", () => {
    expect(sliceBytes.length).toBe(200_000);
    expect(golden.bytes).toBe(sliceBytes.length);
    // 自带 FMT 记录（否则 pymavlink 也解析不了）
    expect(golden.formats.FMT?.type).toBe(0x80);
    expect(golden.counts.FMT).toBeGreaterThan(30);
    expect(Object.keys(golden.series).length).toBeGreaterThan(10);
  });

  it("messageCounts 与 pymavlink 逐消息一致（含未解码消息）", () => {
    expect(doc.messageCounts).toEqual(golden.counts);
    const total = Object.values(golden.counts).reduce((sum, count) => sum + count, 0);
    expect(parsed.stats.records).toBe(total);   // 没有丢记录、也没有多算
  });

  it("逐字段对照：Series 键、字段名、条数、数值、单位全部一致", () => {
    expect(Object.keys(doc.series).sort()).toEqual(Object.keys(golden.series).sort());
    let compared = 0;
    for (const [key, expected] of Object.entries(golden.series)) {
      const actual = doc.series[key];
      expect(actual, `${key} 缺失`).toBeDefined();
      expect(Object.keys(actual.fields).sort(), `${key} 字段名不一致`).toEqual(Object.keys(expected.fields).sort());
      expect(Object.keys(actual.units).sort(), `${key} 单位键不一致`).toEqual(Object.keys(expected.units).sort());
      for (const [field, values] of Object.entries(expected.fields)) {
        const column = actual.fields[field];
        expect(column.length, `${key}.${field} 条数不一致`).toBe(values.length);
        for (let i = 0; i < values.length; i += 1) {
          expect(closeEnough(column[i], values[i]), `${key}.${field}[${i}] ${column[i]} != ${values[i]}`).toBe(true);
          compared += 1;
        }
        expect(actual.units[field] ?? "", `${key}.${field} 单位不一致`).toBe(expected.units[field] ?? "");
      }
    }
    expect(compared).toBeGreaterThan(10_000);   // 这个切片逐一比对了一万多个数值
  });

  it("时间统一为秒（相对起点第一条 TimeUS）", () => {
    expect(parsed.stats.t0us).toBe(golden.t0us);
    const vibe = doc.series["VIBE:0"];
    const firstUs = golden.series["VIBE:0"].fields.TimeUS[0];
    expect(typeof firstUs).toBe("number");
    expect(vibe.timeSec[0]).toBeCloseTo((Number(firstUs) - golden.t0us) / 1e6, 9);
    for (const series of Object.values(doc.series)) {
      expect(series.timeSec.length).toBe(series.fields.TimeUS.length);   // 契约：长度严格相等
    }
  });

  it("params 与 pymavlink 一致（同名取最后一次值）", () => {
    expect(Object.keys(doc.params).sort()).toEqual(Object.keys(golden.params).sort());
    for (const [name, value] of Object.entries(golden.params)) {
      if (!closeEnough(doc.params[name], value)) throw new Error(`param ${name}: ${doc.params[name]} != ${value}`);
    }
  });

  it("多实例消息按 FMTU 的 '#' 拆 Series（VIBE.IMU / IMU.I / GPS.I）", () => {
    for (const key of ["VIBE:0", "VIBE:1", "VIBE:2", "IMU:0", "IMU:1", "IMU:2"]) {
      expect(doc.series[key], key).toBeDefined();
      expect(doc.series[key].instance).toBe(Number(key.split(":")[1]));
    }
    // 单位来自 UNIT+FMTU+MULT（'F' 倍率要按 7 位有效数字取整才能匹配到 µ 前缀，事实见 fmtLayout.ts）
    expect(doc.series["VIBE:0"].units.VibeX).toBe("m/s/s");
    expect(doc.series["IMU:0"].units.GyrX).toBe("rad/s");
    expect(doc.series["IMU:0"].units.TimeUS).toBe("µs");
    expect(golden.formats.VIBE.instanceField).toBe("IMU");
    expect(golden.formats.IMU.instanceField).toBe("I");
  });

  it("meta：横幅/具体机型/数值版本/板型/时长", () => {
    expect(doc.meta.vehicle).toBe("ArduCopter");
    expect(doc.meta.vehicleKind).toBe("copter");     // 规则靠 vehicleKind 决定速率环单位（Copter=rad/s）
    expect(doc.meta.firmwareVersion).toBe("4.6.2");
    expect(doc.meta.versionNumeric).toBe(40602);
    expect(doc.meta.firmwareString).toBe("ArduCopter V4.6.2 (1ebd4d99)");
    expect(doc.meta.board).toBe("Pixhawk6X");
    expect(doc.meta.durationSec).toBeGreaterThan(0);
    expect(doc.meta.durationSec).toBeLessThan(60);
    expect(doc.meta.platform).toBe("ardupilot");
    expect(golden.msgs[0]).toBe("ArduCopter V4.6.2 (1ebd4d99)");
  });

  it("FMT 布局事实：自描述长度与格式字符带宽自洽", () => {
    const header = parseFormatHeader(new Uint8Array(sliceBytes.buffer, sliceBytes.byteOffset + 3, 86));
    expect(header).toMatchObject({ type: 0x80, length: 89, name: "FMT", format: "BBnNZ" });
    expect(header?.columns).toEqual(["Type", "Length", "Name", "Format", "Columns"]);
    expect(buildLayout({ ...header!, length: 88 })).toBeNull();     // 长度不自洽 → 拒绝
    expect(buildLayout({ ...header!, format: "BBnN@" })).toBeNull(); // 未知格式字符 → 拒绝
  });
});

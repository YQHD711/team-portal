/**
 * ULog 的列式累积器：topic(+multi_id) → Series。
 *
 * 与 DataFlash 的 `SeriesAccumulator` 同一套路（列式、最后一次性转 Float64Array），
 * 但**列用可增长 Float64Array**：23 MB 的 PX4 日志有百万级记录，用 `number[]`
 * 会产生大量装箱开销。
 *
 * 字段名沿用 flat 名（数组展开为 `q[0]`/`xyz[2]`/`control[7]`），因此既有规则的
 * `resolveIndex/numberField` 按列名取值约定在 ULog 上同样可用。
 *
 * `char` 字段与 pyulog 的 dtype 一致，按 int8 逐元素暴露成 `callsign[0]…`（不丢字段）。
 */

import type { Series } from "../types/log";
import { dropTrailingPadding, TYPE_INFO, type FlatField } from "./ulogFormat";
import type { UlogReader } from "./ulogReader";

class Column {
  data = new Float64Array(1024);
  length = 0;

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Float64Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length] = value;
    this.length += 1;
  }
}

interface Bucket {
  topic: string;
  instance: number;
  time: Column;
  fields: Map<string, Column>;
}

export interface UlogSeriesResult {
  series: Record<string, Series>;
  /** topic → 记录数（含未产出 Series 的 topic） */
  counts: Map<string, number>;
  /** topic → 数值字段名清单（按格式声明顺序） */
  decodedFields: Map<string, string[]>;
  /** 没有 timestamp 字段、只计数不产出 Series 的 topic（必须能被看到） */
  noTimestamp: string[];
}

export class UlogSeriesBuilder {
  private readonly buckets = new Map<string, Bucket>();
  private readonly counts = new Map<string, number>();
  private readonly fieldsOf = new Map<string, FlatField[]>();
  private readonly noTimestamp = new Set<string>();
  private firstTimestamp: number | null = null;
  /** timestamp=0 的未初始化记录数（保留在数据里，但要能被看到） */
  zeroTimestamps = 0;
  private maxTimestamp = 0;

  /** 日志起点（µs）：第一条带 timestamp 的记录 */
  get t0us(): number {
    return this.firstTimestamp ?? 0;
  }

  /** (topic, multi_id) → 记录数 */
  get datasetCounts(): readonly { name: string; multiId: number; records: number }[] {
    return [...this.buckets.values()].map((b) => ({ name: b.topic, multiId: b.instance, records: b.time.length }));
  }

  /** 最后一条记录的时间戳（µs） */
  get lastUs(): number {
    return this.maxTimestamp;
  }

  /**
   * 解码一条 `D` 记录。
   * 前提：reader 已定位到该 topic 的第一个字段字节；`payloadEnd` 是本条消息 payload 的结束偏移。
   * 返回 false 表示该记录没有有效 timestamp（只计数，不产出 Series）。
   */
  addRecord(
    topic: string,
    instance: number,
    flat: readonly FlatField[],
    reader: UlogReader,
    payloadEnd: number,
  ): boolean {
    this.counts.set(topic, (this.counts.get(topic) ?? 0) + 1);
    if (!flat.some((f) => f.name === "timestamp")) {
      this.noTimestamp.add(topic);
      reader.offset = payloadEnd;
      return false;
    }
    if (!this.fieldsOf.has(topic)) this.fieldsOf.set(topic, [...flat]);
    // 末尾填充可能没写进文件（实测），按 pyulog 一样去掉；中间填充仍要读（保对齐）
    const fields = dropTrailingPadding(flat);

    const key = `${topic}:${instance}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { topic, instance, time: new Column(), fields: new Map() };
      this.buckets.set(key, bucket);
    }

    let timestamp = 0;
    for (const f of fields) {
      if (f.name === "timestamp") {
        timestamp = reader.u64();
        continue;
      }
      if (f.name.startsWith("_padding")) {
        // 对齐填充：占字节但不作为列暴露（仍必须跳过，否则后续字段错位）
        reader.skip(TYPE_INFO[f.type]?.bytes ?? 1);
        continue;
      }
      let column = bucket.fields.get(f.name);
      if (!column) {
        column = new Column();
        bucket.fields.set(f.name, column);
      }
      column.push(reader.number(f.type));
    }
    // 结构对齐填充：payload 尾部可能还有未声明的 `_padding` 字节
    reader.offset = payloadEnd;
    bucket.time.push(timestamp);
    // ⚠️ PX4 会写出 timestamp=0 的未初始化记录：pyulog 照样计入 dataset，
    //    丢一条就会与 oracle 的记录数对不上；这里保留但**不让它污染 t0/时长**，
    //    并单独计数供上层写警告（不允许静默）。
    if (timestamp === 0) {
      this.zeroTimestamps += 1;
      return true;
    }
    if (this.firstTimestamp === null || timestamp < this.firstTimestamp) this.firstTimestamp = timestamp;
    if (timestamp > this.maxTimestamp) this.maxTimestamp = timestamp;
    return true;
  }

  build(): UlogSeriesResult {
    const t0 = this.t0us;
    const series: Record<string, Series> = {};
    for (const [key, bucket] of this.buckets) {
      const count = bucket.time.length;
      if (count === 0) continue;
      const timeSec = new Float64Array(count);
      for (let i = 0; i < count; i += 1) timeSec[i] = (bucket.time.data[i] - t0) / 1e6;
      const fields: Record<string, Float64Array> = {};
      for (const [name, column] of bucket.fields) fields[name] = trim(column, count);
      series[key] = { name: bucket.topic, instance: bucket.instance, timeSec, fields, units: {} };
    }
    const decodedFields = new Map<string, string[]>();
    for (const [topic, flat] of this.fieldsOf) {
      decodedFields.set(topic, flat.filter((f) => TYPE_INFO[f.type]?.numeric === true && !f.name.startsWith("_padding")).map((f) => f.name));
    }
    return { series, counts: this.counts, decodedFields, noTimestamp: [...this.noTimestamp] };
  }
}

function trim(column: Column, count: number): Float64Array {
  if (column.length === count) return column.data.slice(0, count);
  const out = new Float64Array(count);
  out.fill(Number.NaN);
  out.set(column.data.subarray(0, Math.min(column.length, count)));
  return out;
}

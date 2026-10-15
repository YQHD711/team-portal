/**
 * 列式 Series 累积器：把按时间顺序到达的记录追加成 Float64Array，
 * 并按实例号拆成 `NAME:instance`（多实例消息 VIBE/IMU/GPS/BAT/FTN2 的实例列由 FMTU 的 `'#'` 声明）。
 *
 * 为什么列式：9.8 MB 日志有二十多万条记录，逐条建对象再转数组会慢一个量级；
 * 这里只按字段 push 数字，最后一次性转成 Float64Array。
 */

import type { Series } from "../types/log";
import { applyMultiplier, readField, type FormatLayout } from "./layout";

interface Bucket {
  count: number;
  fields: Map<string, number[]>;
}

export interface SeriesBuildResult {
  series: Record<string, Series>;
  /** 因缺少 TimeUS 列而没有产出 Series 的消息名（不静默）。 */
  skippedNoTime: string[];
}

export class SeriesAccumulator {
  private readonly buckets = new Map<string, Bucket>();
  private readonly skipped = new Set<string>();

  constructor(
    private readonly layoutOfType: (type: number) => FormatLayout | undefined,
    private readonly layoutOfName: (name: string) => FormatLayout | undefined,
  ) {}

  /** 解码一条记录（payload 视图从 3 字节头之后开始）。 */
  add(type: number, view: DataView): void {
    const layout = this.layoutOfType(type);
    if (!layout) return;

    const timeIndex = layout.columns.indexOf("TimeUS");
    if (timeIndex < 0 || layout.specs[timeIndex]?.kind === "char") {
      this.skipped.add(layout.name);
      return;
    }

    let instance = 0;
    if (layout.instanceField !== null && layout.instanceOffset >= 0) {
      const index = layout.columns.indexOf(layout.instanceField);
      const raw = readField(view, layout.instanceOffset, layout.specs[index]);
      if (typeof raw === "number" && Number.isFinite(raw)) instance = Math.trunc(raw);
    }

    const key = `${layout.name}:${instance}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, fields: new Map() };
      this.buckets.set(key, bucket);
    }
    let seen = 0;
    for (const index of layout.numericIndexes) {
      const fieldName = layout.columns[index];
      const raw = readField(view, layout.offsets[index], layout.specs[index]);
      if (typeof raw !== "number") continue;
      const value = applyMultiplier(raw, layout.specs[index].multiplier);
      let column = bucket.fields.get(fieldName);
      if (!column) {
        column = [];
        bucket.fields.set(fieldName, column);
      }
      column.push(value);
      seen += 1;
    }
    if (seen > 0) bucket.count += 1;
  }

  /**
   * 收尾：`t0us` 是日志起点（第一条带 TimeUS 的记录），时间统一换算为**秒**（相对日志起点）。
   * 字段长度一律补齐到 `bucket.count`（用 NaN 而不是 0，缺数据不伪装成 0）。
   */
  build(t0us: number): SeriesBuildResult {
    const series: Record<string, Series> = {};
    for (const [key, bucket] of this.buckets) {
      if (bucket.count === 0) continue;
      const split = key.lastIndexOf(":");
      const name = key.slice(0, split);
      const instance = Number(key.slice(split + 1));
      const layout = this.layoutOfName(name);

      const timeSec = new Float64Array(bucket.count);
      const timeRaw = bucket.fields.get("TimeUS");
      if (timeRaw) {
        for (let i = 0; i < bucket.count && i < timeRaw.length; i += 1) {
          timeSec[i] = (timeRaw[i] - t0us) / 1e6;
        }
      }

      const fields: Record<string, Float64Array> = {};
      const units: Record<string, string> = {};
      for (const [fieldName, values] of bucket.fields) {
        const column = new Float64Array(bucket.count);
        for (let i = 0; i < bucket.count; i += 1) {
          column[i] = i < values.length ? values[i] : Number.NaN;
        }
        fields[fieldName] = column;
        const index = layout ? layout.columns.indexOf(fieldName) : -1;
        units[fieldName] = layout && index >= 0 ? layout.units[index] ?? "" : "";
      }
      series[key] = { name, instance, timeSec, fields, units };
    }
    return { series, skippedNoTime: [...this.skipped] };
  }
}

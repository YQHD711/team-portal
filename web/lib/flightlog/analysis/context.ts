/**
 * RuleContext 实现 + 规则共用的小工具。
 *
 * 设计要点：
 *  - 取不到的序列/字段一律返回 null，**不抛异常**（缺数据是常态，不是异常）；
 *  - `series(name)` 在只有一个实例时自动回退，避免规则作者关心实例约定；
 *  - 窗口裁剪返回副本，规则拿到的数组不会因为后续操作污染 LogDocument。
 */

import type {
  ArmedWindow,
  LogDocument,
  Series,
  TimeWindow,
} from "../types/log";
import type { RuleContext, SeriesWindow } from "../types/rule";
import { RATE_UNIT_TO_DEG_PER_SEC } from "./thresholds";
import { detectArmedWindows } from "./windows";

/** 某消息名在文档中的全部实例号（升序） */
export function seriesInstances(doc: LogDocument, name: string): number[] {
  const out: number[] = [];
  for (const key of Object.keys(doc.series)) {
    const sep = key.lastIndexOf(":");
    if (sep < 0) continue;
    if (key.slice(0, sep) === name) out.push(Number(key.slice(sep + 1)));
  }
  return out.sort((a, b) => a - b);
}

/** 速率环原生单位 → deg/s 的系数（机型约定，见 thresholds.ts） */
export function vehicleRateScale(doc: LogDocument): number {
  return RATE_UNIT_TO_DEG_PER_SEC[doc.meta.vehicleKind] ?? 1;
}

function lookup(
  doc: LogDocument,
  name: string,
  instance = 0,
): Series | null {
  const direct = doc.series[`${name}:${instance}`];
  if (direct) return direct;
  if (instance !== 0) return null;
  const all = seriesInstances(doc, name);
  if (all.length !== 1) return null;
  return doc.series[`${name}:${all[0]}`] ?? null;
}

/** 取 [startSec, endSec] 内的连续样本副本；无样本返回 null */
function slice(
  series: Series,
  field: string,
  w: TimeWindow,
): SeriesWindow | null {
  const values = series.fields[field];
  if (!values) return null;
  const times = series.timeSec;
  if (values.length !== times.length) return null;
  let from = -1;
  let to = -1;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t < w.startSec) continue;
    if (t > w.endSec) break;
    if (from < 0) from = i;
    to = i;
  }
  if (from < 0 || to < from) return null;
  return {
    timeSec: times.slice(from, to + 1),
    values: values.slice(from, to + 1),
  };
}

export function createRuleContext(doc: LogDocument): RuleContext {
  const armed = detectArmedWindows(doc);
  return {
    doc,
    series: (name, instance = 0) => lookup(doc, name, instance),
    param: (name) => {
      const v = doc.params[name];
      return typeof v === "number" ? v : null;
    },
    armedWindows: () => armed.windows,
    windowed: (name, field, w, instance = 0) => {
      const s = lookup(doc, name, instance);
      return s ? slice(s, field, w) : null;
    },
  };
}

/** 供规则在 evidence 里说明统计区间来源 */
export function armedSourceNote(doc: LogDocument): string | null {
  return detectArmedWindows(doc).note;
}

/** 中位采样间隔（秒）；样本不足返回 null */
export function medianSampleInterval(
  series: Series | null,
  window?: TimeWindow,
): number | null {
  if (!series) return null;
  const times = series.timeSec;
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) {
    if (window && (times[i] < window.startSec || times[i] > window.endSec)) continue;
    const d = times[i] - times[i - 1];
    if (d > 1e-9) diffs.push(d);
  }
  if (diffs.length < 4) return null;
  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  return diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

export type { ArmedWindow };

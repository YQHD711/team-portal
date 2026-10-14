/**
 * 黄金对照的公共夹具（非 *.test.ts，不会被 vitest 当测试收集）。
 *
 * 切片是真实日志 `quad_20260617.bin` 的**字节精确前缀**（0..200000），自带全部 FMT 记录；
 * 黄金 JSON 由 `tools/flightlog_pymavlink_dump.py`（pymavlink 2.4.49）在同一份字节上生成。
 * CI 上只依赖 `web/tests/fixtures/flightlog/` 里的这两个文件，不碰本机 testdata 目录。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface GoldenSeries {
  fields: Record<string, (number | null)[]>;
  units: Record<string, string>;
}

export interface Golden {
  bytes: number;
  t0us: number;
  counts: Record<string, number>;
  series: Record<string, GoldenSeries>;
  params: Record<string, number>;
  msgs: string[];
  formats: Record<string, { type: number; len: number; format: string; columns: string[]; instanceField: string | null }>;
}

export const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures", "flightlog");
export const SLICE_BIN = join(FIXTURE_DIR, "quad_20260617_head200k.bin");
export const SLICE_GOLDEN = join(FIXTURE_DIR, "quad_20260617_head200k.golden.json");

export const sliceBytes = new Uint8Array(readFileSync(SLICE_BIN));
export const golden = JSON.parse(readFileSync(SLICE_GOLDEN, "utf8")) as Golden;

/** 浮点容差：两边都是 float64 且换算顺序一致，1e-9 相对 + 1e-6 绝对足够严。
 *  golden 里 `null` = pymavlink 的 NaN（JSON 表达不了 NaN，见 tools 脚本的 clean_json）。 */
export function closeEnough(actual: number, expected: number | null): boolean {
  if (expected === null) return Number.isNaN(actual);
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  return Math.abs(actual - expected) <= Math.max(1e-6, 1e-9 * Math.abs(expected));
}

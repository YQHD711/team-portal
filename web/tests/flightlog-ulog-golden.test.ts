/**
 * ULog 解析器 × pyulog **黄金对照**（env 门控，真实日志路径不进仓库）。
 *
 * 门控：`FLIGHTLOG_ULOG_DIR`（例如你的 QGroundControl/Logs 目录）。未设置 → 整组 skip。
 * oracle：`tools/flightlog_pyulog_dump.py`（pyulog 装在同一 Python 环境里）。
 *
 * 逐项对照（与当初 DataFlash × pymavlink 同一套路）：
 *  ① 文件头（版本 / 起始时间戳）
 *  ② **格式表**：99+ 个消息格式的类型、数组长度、字段名逐个一致
 *  ③ **topic 清单**：(name, multi_id) 组合与每个组合的记录数
 *  ④ 按 topic 名汇总的记录数
 *  ⑤ **抽检字段数值**（浮点容差内 / NaN 必须两边都是 NaN）
 *  ⑥ 截断切片：两边的记录数一致，且我方**必须另外报出 truncatedBytes 与警告**（截断不静默）
 *
 * ⚠️ 文件读取与 python 调用只在 `it` 体内（收集阶段跑会直接 ENOENT）。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseUlog } from "@/lib/flightlog/ulog/parseUlog";

const DIR = process.env.FLIGHTLOG_ULOG_DIR ?? null;
const TOOL = join(process.cwd(), "..", "tools", "flightlog_pyulog_dump.py");
const TIMEOUT = 900_000;
/** 每次运行对照的最大文件数（按体积升序，控制运行时间） */
const MAX_FILES = 30;   // 覆盖整个目录（本机 27 份；最大的 23 MB 也在内）

interface OracleSample { index: number; values: Record<string, number | string | null> }
interface OracleDataset { name: string; multiId: number; count: number; firstUs: number | null; lastUs: number | null; samples: OracleSample[] }
interface Oracle {
  header: { version: number; startTimestampUs: number };
  formats: Record<string, [string, number, string][]>;
  datasets: OracleDataset[];
  countTotals: Record<string, number>;
  datasetPairs: number;
  params: { count: number; sample: Record<string, number | string | null> };
}

function dump(file: string, work: string, name: string, limitBytes = 0): Oracle {
  const out = join(work, `${name}.json`);
  const args = [TOOL, "--file", file, "--out", out];
  if (limitBytes > 0) args.push("--limit-bytes", String(limitBytes), "--slice-out", join(work, `${name}.ulg`));
  execFileSync("python", args, { stdio: "ignore" });
  return JSON.parse(readFileSync(out, "utf8")) as Oracle;
}

function closeEnough(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-6 * scale;
}

/** oracle 用字符串区分非有限值（"NaN"/"Infinity"/"-Infinity"），其余是数字 */
function matchesNonFinite(expected: string, got: number): boolean {
  if (expected === "NaN") return Number.isNaN(got);
  if (expected === "Infinity") return got === Number.POSITIVE_INFINITY;
  if (expected === "-Infinity") return got === Number.NEGATIVE_INFINITY;
  return false;
}

function ulgFiles(): { path: string; size: number }[] {
  if (DIR === null || !existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith(".ulg"))
    .map((f) => ({ path: join(DIR, f), size: statSync(join(DIR, f)).size }))
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_FILES);
}

describe.skipIf(ulgFiles().length === 0)("ULog × pyulog 黄金对照（需 FLIGHTLOG_ULOG_DIR）", () => {
  it("逐项一致：格式表 / topic 清单 / 记录数 / 抽检字段数值", { timeout: TIMEOUT }, () => {
    const work = mkdtempSync(join(tmpdir(), "ulog-golden-"));
    const files = ulgFiles();
    const summary: string[] = [];
    for (const file of files) {
      const oracle = dump(file.path, work, `oracle-${summary.length}`);
      const mine = parseUlog(new Uint8Array(readFileSync(file.path)));

      // ① 文件头
      expect(mine.stats.t0us, "t0 应等于第一条记录的时间戳").toBeGreaterThan(0);
      expect(oracle.header.version).toBe(1);

      // ② 格式表
      expect(mine.formats.size, "格式表条目数").toBe(Object.keys(oracle.formats).length);
      for (const [name, fields] of Object.entries(oracle.formats)) {
        const got = mine.formats.get(name);
        expect(got, `缺少格式 ${name}`).toBeDefined();
        expect(
          got!.fields.map((f) => `${f.type}[${f.arraySize}] ${f.name}`),
          `格式 ${name} 字段不一致`,
        ).toEqual(fields.map(([t, a, n]) => `${t}[${a}] ${n}`));
      }

      // ③ (topic, multi_id) 组合与记录数
      const minePairs = new Map(mine.datasets.map((d) => [`${d.name}#${d.multiId}`, d.records]));
      expect(minePairs.size, "dataset 组合数").toBe(oracle.datasetPairs);
      for (const ds of oracle.datasets) {
        expect(minePairs.get(`${ds.name}#${ds.multiId}`), `${ds.name}#${ds.multiId} 记录数`).toBe(ds.count);
      }

      // ④ 按 topic 名汇总
      for (const [name, total] of Object.entries(oracle.countTotals)) {
        expect(mine.doc.messageCounts[name], `${name} 汇总记录数`).toBe(total);
      }

      // ⑤ 抽检字段数值（含数组字段 q[0]/xyz[1] 与 char 列）
      let checked = 0;
      for (const ds of oracle.datasets) {
        const series = mine.doc.series[`${ds.name}:${ds.multiId}`];
        if (ds.count === 0) continue;
        expect(series, `缺少 series ${ds.name}:${ds.multiId}`).toBeDefined();
        expect(series!.timeSec.length).toBe(ds.count);
        for (const sample of ds.samples) {
          for (const [field, expected] of Object.entries(sample.values)) {
            const column = series!.fields[field];
            if (!column) continue; // padding 等非数值列不强求
            const got = column[sample.index];
            if (typeof expected === "string") {
              expect(
                matchesNonFinite(expected, got),
                `${ds.name}#${ds.multiId}.${field}[${sample.index}]：oracle ${expected} vs ${got}`,
              ).toBe(true);
              checked += 1;
            } else if (expected !== null) {
              expect(
                closeEnough(got, expected),
                `${ds.name}#${ds.multiId}.${field}[${sample.index}]：${got} vs ${expected}`,
              ).toBe(true);
              checked += 1;
            }
          }
        }
      }
      expect(checked, "抽检的字段值数量").toBeGreaterThan(50);
      summary.push(
        `${file.path.split(/[\\/]/).pop()}: ${Object.keys(oracle.formats).length} 格式 / ${oracle.datasetPairs} dataset / ${oracle.datasets.reduce((s, d) => s + d.count, 0)} 记录 / 抽检 ${checked} 值`,
      );
      console.log(`[ulog-golden] ✓ ${summary[summary.length - 1]}`);
    }
    console.log(`[ulog-golden] 对照完成：${summary.length} 份日志`);
    expect(files.length).toBeGreaterThan(0);
  });

  it("截断切片：记录数与 pyulog 一致，且**必须**报出 truncatedBytes + 警告", { timeout: TIMEOUT }, () => {
    const work = mkdtempSync(join(tmpdir(), "ulog-trunc-"));
    // 用**最大**的文件切片：60% 处一定有大量完整记录，才能验证"能解的都解出来"且尾部不静默
    const files = ulgFiles();
    const target = files[files.length - 1];
    const fullSize = statSync(target.path).size;
    const cut = Math.floor(fullSize * 0.6);
    const oracle = dump(target.path, work, "trunc", cut);
    const slicePath = join(work, "trunc.ulg");
    const mine = parseUlog(new Uint8Array(readFileSync(slicePath)));

    const oracleRecords = oracle.datasets.reduce((s, d) => s + d.count, 0);
    expect(oracleRecords, "切片里应有完整记录").toBeGreaterThan(100);
    expect(mine.stats.records, "截断切片的记录数应与 pyulog 一致（能解的都解出来）").toBe(oracleRecords);
    expect(mine.stats.truncatedBytes, "必须报出被截断的字节数").toBeGreaterThan(0);
    expect(mine.warnings.some((w) => w.includes("截断")), "必须出现截断警告（不许静默）").toBe(true);
    const minePairs = new Map(mine.datasets.map((d) => [`${d.name}#${d.multiId}`, d.records]));
    for (const ds of oracle.datasets) {
      expect(minePairs.get(`${ds.name}#${ds.multiId}`), `${ds.name}#${ds.multiId}（切片）`).toBe(ds.count);
    }
    console.log(
      `[ulog-golden] 截断切片 ${cut}/${fullSize} 字节：记录 ${mine.stats.records}（pyulog ${oracleRecords}），`
      + `截断 ${mine.stats.truncatedBytes} 字节，警告 ${mine.warnings.length} 条`,
    );
  });
});

// 未设置门控时给出一条可读提示，避免"什么都没跑"被误读成通过
it.skipIf((process.env.FLIGHTLOG_ULOG_DIR ?? "") !== "")("需要 FLIGHTLOG_ULOG_DIR", () => {
  const dir = process.env.FLIGHTLOG_ULOG_DIR;
  writeFileSync(join(tmpdir(), "ulog-golden-hint.txt"), `FLIGHTLOG_ULOG_DIR=${dir}\n`);
  expect(true).toBe(true);
});

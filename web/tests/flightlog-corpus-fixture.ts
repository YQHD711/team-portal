/**
 * 真实语料对照的公共夹具（非 *.test.ts，不会被 vitest 收集）。
 *
 * 基准：`web/tests/fixtures/flightlog/corpus-manifest.json`（pymavlink 2.4.49 对
 * `G:\data\FlightLogs\2026` 全部 76 个唯一 .bin 生成的黄金清单）。
 *
 * 这里只做**纯比较**：把 manifest 条目与 TS 解析结果逐项对齐，返回差异说明数组，
 * 让测试文件能一次性报出"哪些文件哪一项不一致"，而不是第一个断言就中断。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDataflash } from "@/lib/flightlog/dataflash/parseDataflash";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";

export interface ManifestEntry {
  /** 相对语料根目录的路径（含子目录，扩展名可能是 .BIN/.bin） */
  file: string;
  bytes: number;
  records: number;
  messageCounts: Record<string, number>;
  types: number;
  banner: string;
  versionNumeric: number;
  params: number;
  armed_records: number;
  pymavlinkMs: number;
}

interface Manifest {
  root: string;
  files: ManifestEntry[];
}

export const MANIFEST_PATH = join(process.cwd(), "tests", "fixtures", "flightlog", "corpus-manifest.json");
export const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

/** 语料根目录：优先环境变量，其次 manifest 记录的本机根目录（两者都不存在 → 测试整组 skip）。 */
export function corpusRoot(): string {
  return process.env.FLIGHTLOG_CORPUS_DIR ?? manifest.root;
}

export interface FileReport {
  file: string;
  bytes: number;
  records: number;
  types: number;
  decodedTypes: number;
  skippedBytes: number;
  truncatedBytes: number;
  warnings: number;
  ms: number;
  pymavlinkMs: number;
  problems: string[];
}

/** 单文件对照：条数（全部消息类型）/机型/版本/参数数/覆盖度/skippedBytes/规则引擎不抛异常。 */
export function compareFile(entry: ManifestEntry, root: string): FileReport {
  const bytes = new Uint8Array(readFileSync(join(root, entry.file)));
  const problems: string[] = [];
  const started = performance.now();
  const parsed = parseDataflash(bytes);
  const ms = performance.now() - started;
  const doc = parsed.doc;

  if (bytes.length !== entry.bytes) problems.push(`字节数 ${bytes.length} != ${entry.bytes}`);
  if (parsed.stats.records !== entry.records) problems.push(`记录数 ${parsed.stats.records} != ${entry.records}`);

  for (const [name, count] of Object.entries(entry.messageCounts)) {
    const actual = doc.messageCounts[name];
    if (actual !== count) problems.push(`消息 ${name} 条数 ${actual} != ${count}`);
  }
  for (const name of Object.keys(doc.messageCounts)) {
    if (!(name in entry.messageCounts)) problems.push(`多出消息类型 ${name}（pymavlink 没有）`);
  }

  // 横幅是 pymavlink 原始文本 → 与 firmwareString 逐字比较（版本号由 version.ts 从横幅解析）
  if (doc.meta.firmwareString !== entry.banner) {
    problems.push(`横幅 "${doc.meta.firmwareString}" != "${entry.banner}"`);
  }
  const vehicle = entry.banner.split(" ")[0];
  if (doc.meta.vehicle !== vehicle) problems.push(`机型 ${doc.meta.vehicle} != ${vehicle}`);
  if (doc.meta.versionNumeric !== entry.versionNumeric) {
    problems.push(`数值版本 ${doc.meta.versionNumeric} != ${entry.versionNumeric}`);
  }
  if (Object.keys(doc.params).length !== entry.params) {
    problems.push(`参数个数 ${Object.keys(doc.params).length} != ${entry.params}`);
  }

  // 覆盖度判据（契约 §0.5.3）：完整解析后解码类型数必须等于出现过的类型数
  const decodedTypes = Object.keys(doc.decodedFields).length;
  const totalTypes = Object.keys(doc.messageCounts).length;
  if (decodedTypes !== totalTypes) problems.push(`覆盖度 ${decodedTypes}/${totalTypes}（有类型只计数没解码）`);

  // 跳过的字节必须**全部**来自"文件末尾半条记录"：这些日志的下载确实会在记录中间结束，
  // 丢掉它是正确的（pymavlink 同样不发这条），但必须被计入且能说清 —— 不允许别处悄悄跳过。
  if (parsed.stats.skippedBytes !== parsed.stats.truncatedBytes) {
    problems.push(`skippedBytes=${parsed.stats.skippedBytes}，其中截断尾巴只有 ${parsed.stats.truncatedBytes}`
      + `（其余跳过：${parsed.warnings.find((w) => w.includes("跳过")) ?? "无说明"}）`);
  }

  try {
    analyzeLog(doc);
  } catch (error) {
    problems.push(`analyzeLog 抛异常：${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    file: entry.file,
    bytes: bytes.length,
    records: parsed.stats.records,
    types: totalTypes,
    decodedTypes,
    skippedBytes: parsed.stats.skippedBytes,
    truncatedBytes: parsed.stats.truncatedBytes,
    warnings: parsed.warnings.length,
    ms,
    pymavlinkMs: entry.pymavlinkMs,
    problems,
  };
}

/** 汇总表：文件 / MB / 记录数 / 类型数 / 解码类型 / 耗时 / pymavlink 耗时 / skipped */
export function formatSummary(reports: readonly FileReport[]): string {
  const lines = [
    "file".padEnd(44) + "MB".padStart(7) + "records".padStart(10) + "types".padStart(7)
      + "decoded".padStart(9) + "ms".padStart(8) + "pymavlink".padStart(11) + "skipped".padStart(9),
  ];
  for (const r of reports) {
    lines.push(
      r.file.padEnd(44)
      + (r.bytes / 1e6).toFixed(1).padStart(7)
      + String(r.records).padStart(10)
      + String(r.types).padStart(7)
      + String(r.decodedTypes).padStart(9)
      + r.ms.toFixed(0).padStart(8)
      + String(r.pymavlinkMs).padStart(11)
      + String(r.skippedBytes).padStart(9),
    );
  }
  return lines.join("\n");
}

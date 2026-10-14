/**
 * FMT 记录解析与布局构建（格式自描述的核心）：
 *  - `parseFormatHeader`：FMT 记录负载 `Type:u8, Length:u8, Name:char[4], Format:char[16], Columns:char[64]`
 *    （事实：ArduPilot `LogStructure.h` 的 FMT 声明 + pymavlink `DFReader` 的 89 字节 FMT）；
 *  - `buildLayout`：把格式字符串折成每字段的偏移/宽度/倍率，长度必须与声明的 Length 自洽，否则整条弃用；
 *  - `applyFmtu`：FMTU 的三个字段（FmtType/UnitIds/MultIds）→ 实例列 + 单位标签。
 *    `'#'` 位置即实例列（ArduPilot 单位表里 `'#' → "instance"`）。
 */

import {
  FMT_MSG_TYPE, FIELD_SPECS, decodeCString, type FieldSpec, type FormatLayout,
} from "./layout";

export interface FormatHeader {
  type: number;
  name: string;
  length: number;
  format: string;
  columns: string[];
}

/** 倍率 → 单位前缀（事实：pymavlink `MULT_TO_PREFIX`）。 */
const MULT_TO_PREFIX = new Map<number, string>([
  [0, ""], [1, ""], [0.1, "d"], [0.01, "c"], [0.001, "m"], [1e-6, "µ"], [1e-9, "n"],
]);

/**
 * MULT 记录的倍率**要按 7 位有效数字取整**再用（事实：pymavlink `DFReader` 的注释——
 * "multiplier value is logged as a double, the values look to be single-precision cast to double,
 *  we round them to 7 significant decimal digits to index MULT_TO_PREFIX"）。
 * 本机样本里 MULT 'F' 记的是 9.999999974752427e-7（float32 转 double），不取整就匹配不到 1e-6。
 */
export function roundMultiplier(value: number): number {
  return Number(value.toPrecision(7));
}

/** 前缀查表（按键相等已足够；再给一点相对容差防止别的日志写得更"脏"）。 */
function prefixFor(mult: number): string | undefined {
  const exact = MULT_TO_PREFIX.get(mult);
  if (exact !== undefined) return exact;
  for (const [known, prefix] of MULT_TO_PREFIX) {
    if (known !== 0 && Math.abs(mult - known) <= Math.abs(known) * 1e-6) return prefix;
  }
  return undefined;
}

/** `%.4g`（Python 口径）的近似实现，用于"倍率不是 10 的幂"时的单位标签。 */
function format4g(value: number): string {
  return String(Number(value.toPrecision(4)));
}

/** 解析 FMT 记录的负载（不含 3 字节头；`BBnNZ` = 1+1+4+16+64 = 86 字节）。 */
export function parseFormatHeader(payload: Uint8Array): FormatHeader | null {
  if (payload.length < 86) return null;
  const type = payload[0];
  const length = payload[1];
  const name = decodeCString(payload, 2, 4);
  const format = decodeCString(payload, 6, 16);
  const columns = decodeCString(payload, 22, 64)
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
  if (name.length === 0) return null;
  return { type, name, length, format, columns };
}

/** 按 FMT 声明构建布局；格式字符不认识或长度不自洽时返回 null（调用方记 warning 并跳过该消息）。 */
export function buildLayout(header: FormatHeader): FormatLayout | null {
  const offsets: number[] = [];
  const specs: FieldSpec[] = [];
  const numericIndexes: number[] = [];
  let size = 0;
  for (let i = 0; i < header.format.length; i += 1) {
    const spec = FIELD_SPECS[header.format[i]];
    if (!spec) return null;
    offsets.push(size);
    specs.push(spec);
    if (spec.kind !== "char") numericIndexes.push(i);
    size += spec.size;
  }
  if (size + 3 !== header.length) return null;
  return {
    type: header.type,
    name: header.name,
    length: header.length,
    format: header.format,
    columns: header.columns,
    offsets,
    specs,
    numericIndexes,
    units: header.columns.map(() => ""),
    instanceField: null,
    instanceOffset: -1,
    instanceSize: 0,
  };
}

/** FMT 自身：固定 89 字节（`BBnNZ`），必须先钉死否则第一条记录解析不了。 */
export function fmtSelfLayout(): FormatLayout {
  return {
    type: FMT_MSG_TYPE,
    name: "FMT",
    length: 89,
    format: "BBnNZ",
    columns: ["Type", "Length", "Name", "Format", "Columns"],
    offsets: [0, 1, 2, 6, 22],
    specs: [
      { kind: "u8", size: 1, multiplier: null },
      { kind: "u8", size: 1, multiplier: null },
      { kind: "char", size: 4, multiplier: null },
      { kind: "char", size: 16, multiplier: null },
      { kind: "char", size: 64, multiplier: null },
    ],
    numericIndexes: [0, 1],
    units: ["", "", "", "", ""],
    instanceField: null,
    instanceOffset: -1,
    instanceSize: 0,
  };
}

/**
 * 应用 FMTU 声明：实例字段 + 各列单位标签。
 * 单位标签 = UNIT 查表（`'#'` → "instance" 也在表里）；倍率只在**格式字符自身没有倍率**
 * 且该列有单位时，给单位加前缀（与 pymavlink 行为一致——数值换算不看 FMTU 倍率）。
 */
export function applyFmtu(
  layout: FormatLayout,
  unitIds: string,
  multIds: string,
  unitLabels: ReadonlyMap<number, string>,
  multValues: ReadonlyMap<number, number>,
): void {
  const hash = unitIds.indexOf("#");
  if (hash >= 0 && hash < layout.columns.length) {
    layout.instanceField = layout.columns[hash];
    layout.instanceOffset = layout.offsets[hash];
    layout.instanceSize = layout.specs[hash].size;
  }
  for (let i = 0; i < layout.columns.length; i += 1) {
    const unitId = unitIds.charCodeAt(i);
    layout.units[i] = Number.isNaN(unitId) ? "" : unitLabels.get(unitId) ?? "";
  }
  for (let i = 0; i < layout.columns.length; i += 1) {
    if (layout.specs[i].multiplier !== null) continue;
    const multId = multIds.charCodeAt(i);
    if (Number.isNaN(multId)) continue;
    const mult = multValues.get(multId);
    if (mult === undefined || layout.units[i] === "") continue;
    const prefix = prefixFor(mult);
    layout.units[i] = prefix !== undefined ? `${prefix}${layout.units[i]}` : `${format4g(mult)} ${layout.units[i]}`;
  }
}

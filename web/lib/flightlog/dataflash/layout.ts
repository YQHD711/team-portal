/**
 * DataFlash 字段解码基础：记录头常量、格式字符表、按字符读值、倍率换算。
 *
 * 事实来源（只取事实，实现原创）：
 *  - ArduPilot `libraries/AP_Logger/LogStructure.h`：`HEAD_BYTE1 = 0xA3`、`HEAD_BYTE2 = 0x95`、
 *    `LOG_PACKET_HEADER_LEN = 3`；
 *  - pymavlink `DFReader.py` 的 `FORMAT_TO_STRUCT`：格式字符 → 结构体 + 倍率。
 *
 * 关键事实：**每条记录没有校验和**，记录总长由 FMT 记录的 Length 字段自描述（含 3 字节头）。
 * 数值换算只由格式字符决定（'c'/'C'/'e'/'E' = 0.01，'L' = 1e-7）；FMTU 的倍率只影响单位标签前缀。
 */

/** 记录头：0xA3 0x95 + msgType。 */
export const LOG_PACKET_HEADER_LEN = 3;
export const HEAD_BYTE1 = 0xa3;
export const HEAD_BYTE2 = 0x95;
export const FMT_MSG_TYPE = 0x80;

export type FieldKind =
  | "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64"
  | "f32" | "f64" | "f16" | "char";

export interface FieldSpec {
  readonly kind: FieldKind;
  readonly size: number;
  /** 格式字符自带的倍率（非 null 时参与数值换算）。 */
  readonly multiplier: number | null;
}

/** 格式字符表（宽度来自 Python struct 口径：`<B`=1、`<H`=2、`<I`=4、`<Q`=8、`<f`=4、`<d`=8、`<e`=2）。 */
export const FIELD_SPECS: Readonly<Record<string, FieldSpec>> = {
  B: { kind: "u8", size: 1, multiplier: null },
  b: { kind: "i8", size: 1, multiplier: null },
  M: { kind: "i8", size: 1, multiplier: null },
  H: { kind: "u16", size: 2, multiplier: null },
  h: { kind: "i16", size: 2, multiplier: null },
  C: { kind: "u16", size: 2, multiplier: 0.01 },
  c: { kind: "i16", size: 2, multiplier: 0.01 },
  I: { kind: "u32", size: 4, multiplier: null },
  i: { kind: "i32", size: 4, multiplier: null },
  E: { kind: "u32", size: 4, multiplier: 0.01 },
  e: { kind: "i32", size: 4, multiplier: 0.01 },
  L: { kind: "i32", size: 4, multiplier: 1e-7 },
  Q: { kind: "u64", size: 8, multiplier: null },
  q: { kind: "i64", size: 8, multiplier: null },
  f: { kind: "f32", size: 4, multiplier: null },
  d: { kind: "f64", size: 8, multiplier: null },
  g: { kind: "f16", size: 2, multiplier: null },
  n: { kind: "char", size: 4, multiplier: null },
  N: { kind: "char", size: 16, multiplier: null },
  Z: { kind: "char", size: 64, multiplier: null },
  a: { kind: "char", size: 64, multiplier: null },
};

export interface FormatLayout {
  readonly type: number;
  readonly name: string;
  /** 记录总长（含 3 字节头），来自 FMT 声明。 */
  readonly length: number;
  readonly format: string;
  readonly columns: readonly string[];
  /** 每个字段在 payload 内的偏移。 */
  readonly offsets: readonly number[];
  readonly specs: readonly FieldSpec[];
  /** 只有非 char 字段能进 Series（列式数值）。 */
  readonly numericIndexes: readonly number[];
  /** 单位标签（FMTU/UNIT/MULT 可后置补充）。 */
  units: string[];
  instanceField: string | null;
  instanceOffset: number;
  instanceSize: number;
}

/** 以 NUL 结尾的定长字符串（latin1 解码，与日志里的 ASCII 字段一致）。
 *  TextDecoder 复用一份：PARM/MSG 有上千条，每条新建一个明显更慢。 */
const LATIN1 = new TextDecoder("latin1");

export function decodeCString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(offset + length, bytes.length);
  while (end < limit && bytes[end] !== 0) end += 1;
  return LATIN1.decode(bytes.subarray(offset, end)).trim();
}

/** 半精度（格式字符 'g'） → number。 */
function readFloat16(view: DataView, offset: number): number {
  const raw = view.getUint16(offset, true);
  const sign = raw & 0x8000 ? -1 : 1;
  const exponent = (raw >> 10) & 0x1f;
  const mantissa = raw & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** 读一个字段的原始值（char 返回字符串，其余返回 number）。 */
export function readField(view: DataView, offset: number, spec: FieldSpec): number | string {
  switch (spec.kind) {
    case "u8": return view.getUint8(offset);
    case "i8": return view.getInt8(offset);
    case "u16": return view.getUint16(offset, true);
    case "i16": return view.getInt16(offset, true);
    case "u32": return view.getUint32(offset, true);
    case "i32": return view.getInt32(offset, true);
    case "u64": return Number(view.getBigUint64(offset, true));
    case "i64": return Number(view.getBigInt64(offset, true));
    case "f32": return view.getFloat32(offset, true);
    case "f64": return view.getFloat64(offset, true);
    case "f16": return readFloat16(view, offset);
    default: {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, spec.size);
      return decodeCString(bytes, 0, spec.size);
    }
  }
}

/** 倍率换算：与 pymavlink 同口径（0<mult<1 用除法，避免 x*0.01 与 x/100 的 1ULP 差异）。 */
export function applyMultiplier(value: number, multiplier: number | null): number {
  if (multiplier === null || multiplier === 1) return value;
  if (multiplier > 0 && multiplier < 1) return value / (1 / multiplier);
  return value * multiplier;
}

/** `TimeUS` 列（微秒）→ 原始值；没有该列返回 null。 */
export function readTimeUs(view: DataView, layout: FormatLayout): number | null {
  const index = layout.columns.indexOf("TimeUS");
  if (index < 0) return null;
  const spec = layout.specs[index];
  if (!spec || spec.kind === "char") return null;
  const value = readField(view, layout.offsets[index], spec);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

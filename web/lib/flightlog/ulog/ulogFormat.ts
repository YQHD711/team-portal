/**
 * ULog **自描述格式表**：格式串 → 字段布局。
 *
 * ULog 相对 DataFlash 的核心优势就在这里：字段表**写在日志里**（`F` 消息的
 * `name:type field;type field;…` 字符串），所以这里**不允许**出现
 * `vehicle_attitude → [q0,q1,q2,q3]` 这类手工映射表——一旦硬编码，123 个 topic
 * 里没写进表里的全部失效，也就把自描述格式的优点浪费掉了。
 *
 * 与 pyulog（oracle）对齐的三条语义（`pyulog/core.py`）：
 *  ① 基础类型尺寸见 `TYPE_INFO`；`char` 按 1 字节、非数值（不产出数值列）；
 *  ② 数组 `float[4]` 展开成 `q[0]…q[3]`（**按名可取**，延续 DataFlash 的列名约定）；
 *  ③ 嵌套消息类型（字段类型不是基础类型）用 `.` 展开，如 `a.b[1].c`；末尾 `_padding*` 字段剔除。
 */

export interface UlogFieldSpec {
  name: string;
  type: string;
  arraySize: number;
}

export interface UlogMessageFormat {
  name: string;
  fields: UlogFieldSpec[];
}

/** 展开后的字段（数组已展开、嵌套已展平、padding 已剔除） */
export interface FlatField {
  name: string;
  type: string;
}

/** 基础类型 → 字节数 / 是否数值列。来源：pyulog `_UNPACK_TYPES`。 */
export const TYPE_INFO: Readonly<Record<string, { bytes: number; numeric: boolean }>> = {
  int8_t: { bytes: 1, numeric: true },
  uint8_t: { bytes: 1, numeric: true },
  int16_t: { bytes: 2, numeric: true },
  uint16_t: { bytes: 2, numeric: true },
  int32_t: { bytes: 4, numeric: true },
  uint32_t: { bytes: 4, numeric: true },
  int64_t: { bytes: 8, numeric: true },
  uint64_t: { bytes: 8, numeric: true },
  float: { bytes: 4, numeric: true },
  double: { bytes: 8, numeric: true },
  bool: { bytes: 1, numeric: true },
  // pyulog 把 char 当 int8 放进 dtype；这里同样作为数值列暴露（字符串语义由上层按需解码）
  char: { bytes: 1, numeric: true },
};

/** 日志字符串（`L`/`C`）等的 NUL 结尾字符串 */
const NUL = 0;

export function isBasicType(type: string): boolean {
  return TYPE_INFO[type] !== undefined;
}

export function fieldByteSize(type: string, arraySize: number): number {
  const info = TYPE_INFO[type];
  const base = info ? info.bytes : 0;
  return base * Math.max(1, arraySize);
}

/**
 * 解析 `F` 消息的 payload（NUL 结尾字符串）：
 * `name:type1 field1;type2[4] field2;…`
 */
export function parseFormatString(payload: Uint8Array): UlogMessageFormat {
  const text = readCString(payload, 0).text;
  const colon = text.indexOf(":");
  if (colon < 0) throw new Error(`ULog 格式消息缺少 ':' 分隔：${JSON.stringify(text.slice(0, 60))}`);
  const name = text.slice(0, colon);
  if (name.length === 0) throw new Error("ULog 格式消息缺少消息名");
  const fields: UlogFieldSpec[] = [];
  for (const token of text.slice(colon + 1).split(";")) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const space = trimmed.indexOf(" ");
    if (space < 0) throw new Error(`ULog 格式字段缺少类型或名字：${JSON.stringify(trimmed)}`);
    const typeStr = trimmed.slice(0, space);
    const fieldName = trimmed.slice(space + 1).trim();
    const bracket = typeStr.indexOf("[");
    if (bracket < 0) {
      fields.push({ name: fieldName, type: typeStr, arraySize: 0 });
    } else {
      const close = typeStr.indexOf("]", bracket);
      const size = Number.parseInt(typeStr.slice(bracket + 1, close), 10);
      fields.push({
        name: fieldName,
        type: typeStr.slice(0, bracket),
        arraySize: Number.isFinite(size) ? size : 1,
      });
    }
  }
  return { name, fields };
}

/** 读取 buffer[offset..] 的 NUL 结尾字符串；同时返回下一个字节位置 */
export function readCString(buffer: Uint8Array, offset: number): { text: string; next: number } {
  let end = offset;
  while (end < buffer.length && buffer[end] !== NUL) end += 1;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(offset, end));
  return { text, next: Math.min(buffer.length, end + 1) };
}

/** 去掉**末尾**的 `_padding` 字段（pyulog 也是 pop 掉 trailing padding）。
 *  ⚠️ 为什么必须去掉：实测有日志的最后一条记录**没写尾部填充字节**，
 *  要求它存在会 RangeError 并把整条记录丢掉（与 pyulog 的记录数对不上，实测 log_46）。
 *  中间的 padding 必须保留，否则后续字段整体错位。 */
export function dropTrailingPadding(flat: readonly FlatField[]): FlatField[] {
  let end = flat.length;
  while (end > 0 && flat[end - 1].name.startsWith("_padding")) end -= 1;
  return flat.slice(0, end);
}

/**
 * 展平一个消息格式（嵌套 + 数组）。
 * ⚠️ `_padding` 会**保留**在平铺表里（它是 C 结构对齐填充、占字节），
 * 末尾的 padding 由 `dropTrailingPadding` 在读取时去掉。
 */
export function flattenFormat(
  format: UlogMessageFormat,
  formats: ReadonlyMap<string, UlogMessageFormat>,
  prefix = "",
  depth = 0,
): FlatField[] {
  if (depth > 8) throw new Error(`ULog 嵌套类型过深（可能是自引用格式）：${format.name}`);
  const out: FlatField[] = [];
  for (const field of format.fields) {
    const full = `${prefix}${field.name}`;
    // ⚠️ `_padding` 必须留在平铺表里：它是 C 结构对齐填充、占字节。
    //    剔除它会让**后面的字段整体错位**（实测某个 dataset 的 vxy_max[0] 读成了别的字段）。
    //    与 pyulog 的值对齐靠"保留字段 + 末尾填充由 payloadEnd 跳过"，列清单是否暴露由上层决定。
    if (isBasicType(field.type)) {
      if (field.arraySize > 0) {
        for (let i = 0; i < field.arraySize; i += 1) out.push({ name: `${full}[${i}]`, type: field.type });
      } else {
        out.push({ name: full, type: field.type });
      }
      continue;
    }
    const nested = formats.get(field.type);
    if (!nested) throw new Error(`ULog 字段 ${full} 的类型 ${field.type} 未定义（缺少对应 F 消息）`);
    if (field.arraySize > 0) {
      for (let i = 0; i < field.arraySize; i += 1) {
        out.push(...flattenFormat(nested, formats, `${full}[${i}].`, depth + 1));
      }
    } else {
      out.push(...flattenFormat(nested, formats, `${full}.`, depth + 1));
    }
  }
  return out;
}

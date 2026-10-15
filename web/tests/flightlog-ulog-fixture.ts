/**
 * 合成 ULog 测试夹具（非 test 文件）。
 *
 * 为什么要有它：真实日志不能进仓库（路径用环境变量门控），而**格式正确性**必须有 CI 可见的
 * 覆盖。这里按 ULog 规范手工写字节，覆盖真实日志里不一定同时出现的情形：
 * 多实例、数组字段、嵌套类型、char 字段、参数/信息/日志字符串/同步/坏头部/截断。
 */

export class ByteWriter {
  private readonly bytes: number[] = [];

  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { this.bytes.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v: number): this { for (let i = 0; i < 4; i += 1) this.bytes.push((v >> (8 * i)) & 0xff); return this; }
  i8(v: number): this { return this.u8(v); }
  u64(v: number): this { return this.raw64(BigInt(v)); }
  raw32(bits: number): this {
    for (let i = 0; i < 4; i += 1) this.bytes.push((bits >> (8 * i)) & 0xff);
    return this;
  }
  raw64(bits: bigint): this {
    for (let i = 0; i < 8; i += 1) this.bytes.push(Number((bits >> BigInt(8 * i)) & BigInt(255)));
    return this;
  }
  text(value: string): this {
    for (const byte of new TextEncoder().encode(value)) this.bytes.push(byte);
    this.bytes.push(0);
    return this;
  }
  bytesNoNul(value: string): this {
    for (const byte of new TextEncoder().encode(value)) this.bytes.push(byte);
    return this;
  }

  build(): Uint8Array { return new Uint8Array(this.bytes); }
}

function f32Bits(v: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat32(0, v, true);
  return view.getUint32(0, true);
}

function f64Bits(v: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v, true);
  return view.getBigUint64(0, true);
}

export interface UlogSpec {
  version?: number;
  startTimestampUs?: number;
  /** 形如 `vehicle_attitude:uint64_t timestamp;float[4] q;uint8_t _padding0` */
  formats: string[];
  info?: { type: string; key: string; value: number | string }[];
  params?: Record<string, number>;
  subscriptions: { name: string; msgId: number; multiId?: number }[];
  records: { msgId: number; values: (number | string)[] }[];
  /** 记录字段类型表：与 subscriptions 的格式声明顺序一致 */
  recordTypes: Record<number, string[]>;
  logging?: string[];
  syncCount?: number;
  /** 注入任意消息头（用于"未知消息类型"这类负向对照） */
  rawMessages?: { type: string; payload: number[] }[];
  incompatFlag?: boolean;
}

export const ULOG_MAGIC = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];

function message(writer: ByteWriter, type: string, payload: ByteWriter): void {
  const bytes = payload.build();
  writer.u16(bytes.length).u8(type.charCodeAt(0));
  for (const byte of bytes) writer.u8(byte);
}

/** 生成一个字节级正确的 ULog（用于单测；字段顺序必须与 formats 声明一致） */
export function buildUlog(spec: UlogSpec): Uint8Array {
  const writer = new ByteWriter();
  for (const byte of ULOG_MAGIC) writer.u8(byte);
  writer.u8(spec.version ?? 1).u64(spec.startTimestampUs ?? 1_000_000);

  const flag = new ByteWriter();
  // compat[8] 在前、incompat[8] 在后：不兼容标志要落在索引 8 起（否则只是 compat 标志）
  for (let i = 0; i < 16; i += 1) flag.u8(spec.incompatFlag === true && i === 8 ? 2 : 0);
  for (let i = 0; i < 24; i += 1) flag.u8(0);
  message(writer, "B", flag);

  for (const format of spec.formats) message(writer, "F", new ByteWriter().text(format));

  for (const item of spec.info ?? []) {
    const key = `${item.type} ${item.key}`;
    const payload = new ByteWriter().u8(key.length).bytesNoNul(key);
    if (typeof item.value === "string") payload.text(item.value);
    else if (item.type === "uint32_t") payload.u32(item.value);
    else if (item.type === "float") payload.raw32(f32Bits(item.value));
    else payload.u8(item.value);
    message(writer, "I", payload);
  }

  for (const [name, value] of Object.entries(spec.params ?? {})) {
    const key = `float ${name}`;
    message(writer, "P", new ByteWriter().u8(key.length).bytesNoNul(key).raw32(f32Bits(value)));
  }

  for (const sub of spec.subscriptions) {
    message(writer, "A", new ByteWriter().u8(sub.multiId ?? 0).u16(sub.msgId).text(sub.name));
  }

  for (const record of spec.records) {
    const payload = new ByteWriter().u16(record.msgId);
    const types = spec.recordTypes[record.msgId] ?? [];
    record.values.forEach((value, index) => {
      const type = types[index] ?? "float";
      if (type === "uint64_t") payload.u64(Number(value));
      else if (type === "uint32_t") payload.u32(Number(value));
      else if (type === "uint16_t") payload.u16(Number(value));
      else if (type === "uint8_t") payload.u8(Number(value));
      else if (type === "int32_t") payload.u32(Number(value));
      // char[N]：按声明长度给足字节（不足会错位），不加额外的 NUL
      else if (type === "char") payload.bytesNoNul(String(value));
      else payload.raw32(f32Bits(Number(value)));
    });
    message(writer, "D", payload);
  }

  for (const raw of spec.rawMessages ?? []) {
    message(writer, raw.type, (() => { const w = new ByteWriter(); for (const b of raw.payload) w.u8(b); return w; })());
  }
  for (let i = 0; i < (spec.syncCount ?? 0); i += 1) {
    message(writer, "S", new ByteWriter().bytesNoNul("Sync"));
  }
  for (const text of spec.logging ?? []) {
    message(writer, "L", new ByteWriter().u8(0x36).u64(1_100_000).text(text));
  }
  return writer.build();
}

/** 一个包含多实例 + 数组字段 + 属性列的最小日志 */
export function minimalUlog(): Uint8Array {
  return buildUlog({
    startTimestampUs: 1_000_000,
    formats: [
      "sensor_gyro:uint64_t timestamp;float[3] xyz;uint8_t _padding0",
      "vehicle_attitude:uint64_t timestamp;float[4] q",
      "actuator_armed:uint64_t timestamp;bool armed",
      "nested_outer:uint64_t timestamp;inner_t inner;int32_t count",
      "inner_t:float a;float b",
      "gps:uint64_t timestamp;char[4] tag;float lat",
    ],
    info: [
      { type: "uint32_t", key: "ver_sw_release", value: 0x010d07ff },
      { type: "char[6]", key: "ver_hw", value: "V6C21" },
      { type: "char[3]", key: "sys_name", value: "PX4" },
    ],
    params: { ATC_RAT_RLL_P: 0.15 },
    subscriptions: [
      { name: "sensor_gyro", msgId: 1, multiId: 0 },
      { name: "sensor_gyro", msgId: 2, multiId: 1 },
      { name: "vehicle_attitude", msgId: 3 },
      { name: "actuator_armed", msgId: 4 },
      { name: "nested_outer", msgId: 5 },
      { name: "gps", msgId: 6 },
    ],
    recordTypes: {
      1: ["uint64_t", "float", "float", "float", "uint8_t"],
      2: ["uint64_t", "float", "float", "float", "uint8_t"],
      3: ["uint64_t", "float", "float", "float", "float"],
      4: ["uint64_t", "uint8_t"],
      5: ["uint64_t", "float", "float", "int32_t"],
      6: ["uint64_t", "char", "float"],
    },
    records: [
      { msgId: 1, values: [1_000_000, 1, 2, 3, 0] },
      { msgId: 2, values: [1_000_000, 11, 12, 13, 0] },
      { msgId: 3, values: [1_000_000, 1, 0, 0, 0] },
      { msgId: 4, values: [1_000_000, 0] },
      { msgId: 4, values: [1_100_000, 1] },
      { msgId: 5, values: [1_000_000, 1.5, 2.5, 7] },
      { msgId: 6, values: [1_000_000, "AB\u0000\u0000", 3.5] },
    ],
    logging: ["armed by RC"],
    syncCount: 1,
  });
}

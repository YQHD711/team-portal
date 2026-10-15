/**
 * ULog 字节读取器：小端、**越界必须抛**（由调用方决定是跳过还是判截断）。
 *
 * 不用 DataView 的 getUint8 逐字节调用（23 MB 日志会有千万次调用），
 * 这里持有 DataView + 游标，读取方法只管推进 offset。
 */

export class UlogReader {
  offset = 0;

  constructor(
    private readonly view: DataView,
    offset = 0,
  ) {
    this.offset = offset;
  }

  get byteLength(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  private ensure(bytes: number): number {
    const at = this.offset;
    if (at + bytes > this.view.byteLength) {
      throw new RangeError(`ULog 读取越界：需要 ${bytes} 字节，剩余 ${this.view.byteLength - at}（offset ${at}）`);
    }
    this.offset = at + bytes;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.ensure(1));
  }
  i8(): number {
    return this.view.getInt8(this.ensure(1));
  }
  u16(): number {
    return this.view.getUint16(this.ensure(2), true);
  }
  i16(): number {
    return this.view.getInt16(this.ensure(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.ensure(4), true);
  }
  i32(): number {
    return this.view.getInt32(this.ensure(4), true);
  }
  u64(): number {
    return Number(this.view.getBigUint64(this.ensure(8), true));
  }
  i64(): number {
    return Number(this.view.getBigInt64(this.ensure(8), true));
  }
  f32(): number {
    return this.view.getFloat32(this.ensure(4), true);
  }
  f64(): number {
    return this.view.getFloat64(this.ensure(8), true);
  }
  bool(): number {
    return this.u8() === 0 ? 0 : 1;
  }

  /** 按 ULog 基础类型名读一个数值（char 返回字符串，调用方需自行处理） */
  number(type: string): number {
    switch (type) {
      case "int8_t": return this.i8();
      case "uint8_t": return this.u8();
      case "int16_t": return this.i16();
      case "uint16_t": return this.u16();
      case "int32_t": return this.i32();
      case "uint32_t": return this.u32();
      case "int64_t": return this.i64();
      case "uint64_t": return this.u64();
      case "float": return this.f32();
      case "double": return this.f64();
      case "bool":
        // ⚠️ 不归一化成 0/1：pyulog 把 bool 映射成 np.int8，**原样**给出字节
        //    （实测 rtl_status.has_vtol_approach 里是 0x99 = -103，归一化就会与 oracle 不一致）。
        //    规则判"真/假"时用 `!== 0` 即可。
        return this.i8();
      // pyulog 把 char 当 int8 处理（dtype 里逐元素成列）；字符串语义由上层按需解码
      case "char": return this.i8();
      default: throw new Error(`ULog 未知基础类型：${type}`);
    }
  }

  skip(bytes: number): void {
    this.ensure(bytes);
  }

  subarray(start: number, end: number): Uint8Array {
    return new Uint8Array(this.view.buffer, this.view.byteOffset + start, Math.max(0, end - start));
  }
}

#!/usr/bin/env python3
"""DataFlash 黄金对照导出（oracle）。

为什么需要它：解析正确性不能"看起来对" —— 必须与 pymavlink 在同一段字节上逐字段对照。
本脚本只用 pymavlink 的**公开 API**（mavutil.mavlink_connection / recv_match / formats / params），
不复制任何解析器实现代码（pymavlink 的 DFReader 仅作为已知行为的事实来源）。

用法（在仓库根目录执行）：

    # 1) 从真实日志切出字节精确的小片（fixture）+ 同片黄金 JSON
    python tools/flightlog_pymavlink_dump.py \
        "G:/ardupilot_log_analysis/WebTools/testdata/quad_20260617.bin" \
        web/tests/fixtures/flightlog/quad_20260617_head200k.golden.json \
        --start 0 --end 200000 --write-slice web/tests/fixtures/flightlog/quad_20260617_head200k.bin

    # 2) 只输出统计（侦察用）
    python tools/flightlog_pymavlink_dump.py <bin> - --stats

输出 JSON 结构（键名与 TS 侧解析结果一一对应）：
  { slice:{...}, formats:{名称->布局}, counts:{全部消息->条数}, series:{"NAME:inst"->{fields,units}},
    params:{...}, t0us, msgs:[...], ver:{...} }
"""

import argparse
import json
import math
import os
import sys
import tempfile

from pymavlink import mavutil


def clean_json(obj):
    """NaN / Infinity 不是合法 JSON（Python 会写成裸 NaN）→ 统一转成 null 由测试按 NaN 处理。"""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: clean_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_json(v) for v in obj]
    return obj

# task-24：**没有白名单**（TS 侧解码全部 FMT 声明的类型）。
# 只有"声明类"消息不产出 Series：它们是布局/单位/倍率本身，不是时序数据。
NO_SERIES = {"FMT", "FMTU", "UNIT", "MULT"}

NUMERIC = (int, float)


def read_slice(path: str, start: int, end: int | None) -> bytes:
    with open(path, "rb") as fh:
        fh.seek(start)
        return fh.read() if end is None else fh.read(end - start)


def dump(data: bytes, source: str, start: int, end: int) -> dict:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".bin") as tmp:
        tmp.write(data)
        tmp_name = tmp.name
    try:
        conn = mavutil.mavlink_connection(tmp_name)
        seen_types: dict[str, int] = {}          # 消息名 → type id（结尾统一取最终 units）
        series_type: dict[str, int] = {}         # series key → type id
        fmtu_latest: dict[int, tuple[str, str]] = {}   # FmtType → (UnitIds, MultIds)
        series: dict[str, dict] = {}
        counts: dict[str, int] = {}
        msgs: list[str] = []
        ver: dict | None = None
        ev_counts: dict[str, int] = {}
        arm_states: dict[str, int] = {}
        t0us: int | None = None

        while True:
            msg = conn.recv_match()
            if msg is None:
                break
            name = msg.get_type()
            counts[name] = counts.get(name, 0) + 1
            row = msg.to_dict()
            time_us = row.get("TimeUS")
            if t0us is None and isinstance(time_us, NUMERIC):
                t0us = int(time_us)

            fmt = msg.fmt
            seen_types.setdefault(name, fmt.type)

            if name == "MSG" and len(msgs) < 6:
                msgs.append(str(row.get("Message", "")))
            if name == "FMTU":
                # 记下最后的 FMTU 声明（UnitIds/MultIds），结尾用 pymavlink 自己的查表逻辑重算单位。
                # 为什么要重算：pymavlink 内部某些调用路径会把 units 清成 ''（实测 HEAT 252 就是如此），
                # 而用它的 set_unit_ids/set_mult_ids + 最终字符串算出来是 'µs'/'UNKNOWN' —— 与 TS 侧一致。
                fmtu_latest[int(row["FmtType"])] = (str(row["UnitIds"]), str(row["MultIds"]))
            if name == "VER" and ver is None:
                ver = {k: v for k, v in row.items() if k != "mavpackettype"}
            if name == "EV" and isinstance(row.get("Id"), NUMERIC):
                ev_counts[str(int(row["Id"]))] = ev_counts.get(str(int(row["Id"])), 0) + 1
            if name == "ARM" and isinstance(row.get("ArmState"), NUMERIC):
                arm_states[str(int(row["ArmState"]))] = arm_states.get(str(int(row["ArmState"])), 0) + 1

            if name in NO_SERIES:
                continue
            # 与 TS 侧同口径：没有 TimeUS 列的消息不产出 Series（时间轴无法表达）
            if "TimeUS" not in fmt.columns:
                continue

            inst_field = fmt.instance_field
            instance = int(row[inst_field]) if inst_field and isinstance(row.get(inst_field), NUMERIC) else 0
            key = f"{name}:{instance}"
            bucket = series.setdefault(key, {"fields": {}, "units": {}})
            series_type[key] = fmt.type
            for col in fmt.columns:
                value = row.get(col)
                if not isinstance(value, NUMERIC) or isinstance(value, bool):
                    continue
                bucket["fields"].setdefault(col, []).append(value)

        # ⚠️ 单位必须在**整份文件解析完之后**取：FMTU 可能出现在某类型的第一条记录之后，
        # 边读边取会拿到未更新的单位表（这曾导致 HEAT 的 TimeUS 单位对不上）。
        final_formats = conn.formats
        for type_id, (unit_ids, mult_ids) in fmtu_latest.items():
            fmt = final_formats.get(type_id)
            if fmt is None:
                continue
            fmt.set_unit_ids(unit_ids, conn.unit_lookup)
            fmt.set_mult_ids(mult_ids, conn.mult_lookup)
        for key, bucket in series.items():
            fmt = final_formats.get(series_type[key])
            if fmt is None or fmt.units is None:
                continue
            for col in bucket["fields"]:
                if col in fmt.columns:
                    idx = fmt.columns.index(col)
                    bucket["units"][col] = fmt.units[idx] or ""

        formats: dict[str, dict] = {}
        for name, type_id in seen_types.items():
            fmt = final_formats.get(type_id)
            formats[name] = {
                "type": type_id,
                "len": fmt.len if fmt is not None else None,
                "format": fmt.format if fmt is not None else None,
                "columns": list(fmt.columns) if fmt is not None else [],
                "units": (list(fmt.units) if fmt is not None and fmt.units is not None else None),
                "instanceField": fmt.instance_field if fmt is not None else None,
                "mults": list(fmt.msg_mults) if fmt is not None else [],
            }
        return {
            "source": source,
            "start": start,
            "end": end,
            "bytes": len(data),
            "t0us": t0us,
            "formats": formats,
            "allFormatNames": sorted(formats.keys()),
            "counts": counts,
            "series": series,
            "params": {k: v for k, v in conn.params.items()},
            "msgs": msgs,
            "ver": ver,
            "evCounts": ev_counts,
            "armStates": arm_states,
        }
    finally:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser(description="pymavlink oracle dump for DataFlash slices")
    ap.add_argument("bin")
    ap.add_argument("out", help="输出 JSON 路径；'-' 表示只打印统计")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=None)
    ap.add_argument("--write-slice", default=None, help="把同一段字节写成 fixture 文件")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    end = args.end if args.end is not None else os.path.getsize(args.bin)
    data = read_slice(args.bin, args.start, end)
    if args.write_slice:
        with open(args.write_slice, "wb") as fh:
            fh.write(data)

    result = dump(data, args.bin, args.start, end)

    if args.stats:
        print(json.dumps({
            "bytes": result["bytes"],
            "t0us": result["t0us"],
            "types": len(result["counts"]),
            "records": sum(result["counts"].values()),
            "series": {k: len(v["fields"].get("TimeUS", [])) for k, v in result["series"].items()},
        }, ensure_ascii=False, indent=2))
        return 0

    if args.out != "-":
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(clean_json(result), fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())

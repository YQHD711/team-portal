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

# 与 TS 侧白名单一致（只有这些消息会被解码成 Series）
WHITELIST = [
    "FMT", "FMTU", "UNIT", "MULT", "PARM", "VIBE", "PIDR", "PIDP", "PIDY", "RATE", "ATT",
    "IMU", "FTN1", "FTN2", "RCOU", "CTUN", "POWR", "BAT", "GPS", "EV", "MODE", "ARM", "MSG", "VER",
]
# 元信息/声明类消息：计入 counts，但不产出 Series（值是字符串，或本身是布局声明）
NO_SERIES = {"FMT", "FMTU", "UNIT", "MULT", "PARM", "MSG"}

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
        formats: dict[str, dict] = {}
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

            # 格式表（第一次见到该消息时记录，布局事实来自 pymavlink 自己）
            fmt = msg.fmt
            if name not in formats:
                formats[name] = {
                    "type": fmt.type,
                    "len": fmt.len,
                    "format": fmt.format,
                    "columns": list(fmt.columns),
                    "units": list(fmt.units) if fmt.units is not None else None,
                    "instanceField": fmt.instance_field,
                    "mults": list(fmt.msg_mults),
                }

            if name == "MSG":
                if len(msgs) < 6:
                    msgs.append(str(row.get("Message", "")))
                continue
            if name == "VER" and ver is None:
                ver = {k: v for k, v in row.items() if k != "mavpackettype"}
            if name == "EV" and isinstance(row.get("Id"), NUMERIC):
                ev_counts[str(int(row["Id"]))] = ev_counts.get(str(int(row["Id"])), 0) + 1
            if name == "ARM" and isinstance(row.get("ArmState"), NUMERIC):
                arm_states[str(int(row["ArmState"]))] = arm_states.get(str(int(row["ArmState"])), 0) + 1

            if name not in WHITELIST or name in NO_SERIES:
                continue

            inst_field = fmt.instance_field
            instance = int(row[inst_field]) if inst_field and isinstance(row.get(inst_field), NUMERIC) else 0
            key = f"{name}:{instance}"
            bucket = series.setdefault(key, {"fields": {}, "units": {}})
            for idx, col in enumerate(fmt.columns):
                value = row.get(col)
                if not isinstance(value, NUMERIC) or isinstance(value, bool):
                    continue
                bucket["fields"].setdefault(col, []).append(value)
                unit = fmt.units[idx] if fmt.units is not None and idx < len(fmt.units) else ""
                if col not in bucket["units"]:
                    bucket["units"][col] = unit or ""
        return {
            "source": source,
            "start": start,
            "end": end,
            "bytes": len(data),
            "t0us": t0us,
            "whitelist": WHITELIST,
            "formats": {k: v for k, v in formats.items() if k in WHITELIST},
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

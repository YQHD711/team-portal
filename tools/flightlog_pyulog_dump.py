#!/usr/bin/env python3
"""pyulog 黄金对照转储（oracle）——与当初 DataFlash 用 pymavlink 对照同一套路。

用法：
    python tools/flightlog_pyulog_dump.py --file <x.ulg> --out out.json [--samples 8]
                                          [--limit-bytes N] [--slice-out y.ulg]

输出 JSON（供 `web/tests/flightlog-ulog-golden.test.ts` 逐项对照）：
  header      ：文件版本、起始时间戳
  formats     ：消息名 → [[类型, 数组长度, 字段名], …]（**自描述格式表**，对照 TS 解析结果）
  datasets    ：[{name, multiId, count, firstUs, lastUs, samples:[{index, values}]}]
  params      ：参数个数 + 抽检
  countTotals ：topic 名（不含 multi_id）→ 记录总数；以及 name+multiId 组合数
  loggedMessages / dropouts / syncCount / corrupt

数值一律 JSON 化（NaN/Inf → null）；`--limit-bytes` 用于生成"截断切片"负向样本，
`--slice-out` 把前 N 字节写成新文件（**故意截断**，用于验证"截断不静默"）。
"""

import argparse
import json
import math
import os
import sys
from collections import defaultdict

from pyulog import ULog


def jsonable(value):
    if isinstance(value, (str, bool)) or value is None:
        return value
    if isinstance(value, (int,)):
        return int(value)
    if isinstance(value, (float,)):
        # ⚠️ NaN / ±Inf 必须区分开：PX4 会真的写 +Inf（"不限制"），
        #    统一转成 null 会让"我方是 Infinity"看起来像不一致（实测踩过）。
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return float(value)
    try:
        if hasattr(value, "item"):
            return jsonable(value.item())
    except Exception:  # noqa: BLE001 - oracle 尽力而为，失败退回字符串
        pass
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--limit-bytes", type=int, default=0)
    parser.add_argument("--slice-out", default="")
    args = parser.parse_args()

    if args.limit_bytes > 0:
        with open(args.file, "rb") as src:
            chunk = src.read(args.limit_bytes)
        if args.slice_out:
            with open(args.slice_out, "wb") as dst:
                dst.write(chunk)
            args.file = args.slice_out
        else:
            raise SystemExit("--limit-bytes 需要配合 --slice-out")

    ulog = ULog(args.file)

    formats = {}
    for name, fmt in ulog._message_formats.items():
        formats[name] = [[t, int(a), n] for (t, a, n) in fmt.fields]

    datasets = []
    totals = defaultdict(int)
    for dataset in sorted(ulog.data_list, key=lambda d: (d.name, d.multi_id)):
        keys = list(dataset.data.keys())
        count = len(dataset.data[keys[0]]) if keys else 0
        totals[dataset.name] += count
        stamps = dataset.data.get("timestamp")
        samples = []
        if count > 0:
            for index in sorted({0, count // 2, count - 1, *[count // (args.samples + 1) * (i + 1) for i in range(args.samples)]}):
                if index < 0 or index >= count:
                    continue
                samples.append({
                    "index": int(index),
                    "values": {k: jsonable(dataset.data[k][index]) for k in keys},
                })
        datasets.append({
            "name": dataset.name,
            "multiId": int(dataset.multi_id),
            "count": int(count),
            "firstUs": jsonable(stamps[0]) if stamps is not None and count else None,
            "lastUs": jsonable(stamps[-1]) if stamps is not None and count else None,
            "samples": samples,
        })

    params = dict(list(ulog.initial_parameters.items())[:20]) if ulog.initial_parameters else {}
    payload = {
        "file": os.path.basename(args.file),
        "bytes": os.path.getsize(args.file),
        "header": {
            "version": int(ulog._file_version),
            "startTimestampUs": int(ulog.start_timestamp),
        },
        "formats": formats,
        "datasets": datasets,
        "countTotals": dict(totals),
        "datasetPairs": len(datasets),
        "params": {"count": len(ulog.initial_parameters), "sample": {k: jsonable(v) for k, v in params.items()}},
        "loggedMessages": [m.message for m in ulog.logged_messages],
        "dropouts": len(ulog.dropouts),
        "syncCount": int(ulog._sync_seq_cnt),
        "corrupt": bool(ulog._file_corrupt),
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    print(f"wrote {args.out}: {len(formats)} formats / {len(datasets)} datasets / {sum(totals.values())} records")
    return 0


if __name__ == "__main__":
    sys.exit(main())

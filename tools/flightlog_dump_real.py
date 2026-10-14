"""把真实 .bin 导出成与 web/lib/flightlog/types/log.ts 对齐的 LogDocument JSON。

用途：**脱离解析器**独立验证诊断引擎在真实数据上的结论是否符合标定预期。
（解析器的正确性由 pymavlink 黄金对照单独验证；这里只验证规则判定。）
"""
import json, os, sys, collections
from pymavlink import mavutil

WANTED = {
    "VIBE": ["VibeX", "VibeY", "VibeZ", "Clip"],
    "PIDR": ["Tar", "Act", "Err", "P", "I", "D", "FF"],
    "PIDP": ["Tar", "Act", "Err", "P", "I", "D", "FF"],
    "PIDY": ["Tar", "Act", "Err", "P", "I", "D", "FF"],
    "FTN1": ["PkAvg", "BwAvg", "SnX", "SnY", "SnZ", "FtX", "FtY", "FtZ"],
}
IMU_FIELDS = ["AccZ", "GyrX", "GyrY", "GyrZ"]
IMU_CAP = 8192
PARM_KEEP_PREFIX = ("INS_HNTCH", "INS_HNTC2", "INS_LOG_BAT", "INS_GYRO_FILTER",
                    "FFT_", "ATC_RAT", "MOT_THST_HOVER", "SCHED_LOOP_RATE",
                    "INS_ACCEL_FILTER")
EV_LABELS = {10: ("arm", "ARMED"), 11: ("disarm", "DISARMED"),
             15: ("arm", "AUTO_ARMED"), 17: ("other", "LAND_COMPLETE_MAYBE"),
             18: ("other", "LAND_COMPLETE"), 28: ("other", "NOT_LANDED"),
             56: ("info", "EV_56"), 57: ("info", "EV_57"), 62: ("info", "EV_62")}


def dump(path, out_path):
    m = mavutil.mavlink_connection(path, robust_parsing=True)
    series = collections.defaultdict(lambda: {"time": [], "fields": collections.defaultdict(list)})
    imu_instances = collections.Counter()
    params, events, mode = {}, [], None
    banner, board = None, None
    first = last = None
    counts = collections.Counter()
    while True:
        mm = m.recv_match()
        if mm is None:
            break
        t = mm.get_type()
        counts[t] += 1
        tus = getattr(mm, "TimeUS", None)
        if tus is not None:
            ts = tus / 1e6
            if first is None:
                first = ts
            last = ts
        if t in WANTED:
            inst = 0
            if t == "VIBE":
                inst = int(getattr(mm, "IMU", 0))
            key = f"{t}:{inst}"
            series[key]["time"].append(ts)
            for f in WANTED[t]:
                series[key]["fields"][f].append(float(getattr(mm, f, 0.0)))
        elif t == "IMU":
            inst = int(getattr(mm, "I", 0))
            if imu_instances[inst] < IMU_CAP:
                imu_instances[inst] += 1
                key = f"IMU:{inst}"
                series[key]["time"].append(ts)
                for f in IMU_FIELDS:
                    series[key]["fields"][f].append(float(getattr(mm, f, 0.0)))
        elif t == "PARM":
            if mm.Name.startswith(PARM_KEEP_PREFIX):
                params[mm.Name] = float(mm.Value)
        elif t == "EV":
            kind, label = EV_LABELS.get(int(mm.Id), ("other", f"EV_{int(mm.Id)}"))
            events.append({"tSec": ts, "kind": kind, "code": int(mm.Id), "label": label})
        elif t == "MSG":
            s = getattr(mm, "Message", "")
            if "V" in s and banner is None and ("Ardu" in s or "PX4" in s):
                banner = s
        elif t == "MODE" and mode is None:
            mode = int(mm.Mode)

    doc = {
        "meta": {
            "platform": "ardupilot",
            "vehicleKind": "copter" if "Copter" in (banner or "") else (
                "plane" if "Plane" in (banner or "") else "unknown"),
            "vehicle": (banner or "").split(" V")[0] or "ArduCopter",
            "firmwareVersion": (banner or "").split(" V")[-1].split(" ")[0],
            "firmwareString": banner or "",
            "versionNumeric": 0,
            "board": board,
            "durationSec": (last - first) if first is not None else 0.0,
            "armed": True,
        },
        "series": {
            k: {"name": k.split(":")[0], "instance": int(k.split(":")[1]),
                "timeSec": v["time"], "fields": dict(v["fields"]),
                "units": {"Tar": "rad/s" if "Copter" in (banner or "") else "deg/s"}}
            for k, v in series.items()
        },
        "events": events,
        "params": params,
        "messageCounts": dict(counts),
        "decodedFields": {k: list(v) for k, v in WANTED.items()},
        "warnings": [],
    }
    # 版本号
    import re
    mm2 = re.search(r"(\d+)\.(\d+)\.(\d+)", banner or "")
    if mm2:
        doc["meta"]["versionNumeric"] = int(mm2.group(1)) * 10000 + int(mm2.group(2)) * 100 + int(mm2.group(3))
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False)
    print(f"{os.path.basename(path)} -> {os.path.basename(out_path)} "
          f"{os.path.getsize(out_path)/1024:.0f} KB series={len(series)} events={len(events)} "
          f"params={len(params)} banner={banner!r}")


if __name__ == "__main__":
    out_dir = os.path.join(os.environ.get("TEMP", "."), "flog_real")
    os.makedirs(out_dir, exist_ok=True)
    for p, name in [
        (r"G:\ardupilot_log_analysis\WebTools\testdata\quad_20260617.bin", "quad"),
        (r"G:\ardupilot_log_analysis\WebTools\testdata\fr_batch_0713.bin", "fr_batch"),
        (r"G:\ardupilot_log_analysis\WebTools\testdata\flight_20260527.bin", "f0527"),
        (r"G:\ardupilot_log_analysis\2026-05-09 15-53-35.bin", "user0509"),
    ]:
        dump(p, os.path.join(out_dir, f"{name}.json"))

"""对 G:\\data\\FlightLogs\\2026 下全部 .bin 生成 pymavlink 黄金基准清单。

用途：让 TS 解析器在**真实语料**上逐文件对照（记录数、全部消息条数、机型/版本、参数数）。
这份清单是 oracle，不是"看起来合理"的估计值。
"""
import glob, json, os, re, sys, time
from pymavlink import mavutil

ROOT = r"G:\data\FlightLogs\2026"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", "."), "flog_corpus_manifest.json")


def probe(path):
    t0 = time.time()
    m = mavutil.mavlink_connection(path, robust_parsing=True)
    counts = {}
    banner = None
    n = 0
    while True:
        mm = m.recv_match()
        if mm is None:
            break
        n += 1
        t = mm.get_type()
        counts[t] = counts.get(t, 0) + 1
        if banner is None and t == "MSG":
            s = getattr(mm, "Message", "")
            if "Ardu" in s and " V" in s:
                banner = s
    m2 = re.search(r"(\d+)\.(\d+)\.(\d+)", banner or "")
    numeric = (int(m2.group(1)) * 10000 + int(m2.group(2)) * 100 + int(m2.group(3))) if m2 else 0
    return {
        "file": os.path.relpath(path, ROOT).replace("\\", "/"),
        "bytes": os.path.getsize(path),
        "records": n,
        "messageCounts": counts,
        "types": len(counts),
        "banner": banner,
        "versionNumeric": numeric,
        "params": len(m.params),
        "armed_records": counts.get("ARM", 0),
        "pymavlinkMs": round((time.time() - t0) * 1000),
    }


def main():
    files = sorted(
        glob.glob(os.path.join(ROOT, "**", "*.bin"), recursive=True)
        + glob.glob(os.path.join(ROOT, "**", "*.BIN"), recursive=True)
    )
    seen, uniq = set(), []
    for f in files:
        key = os.path.normcase(os.path.abspath(f))
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    print(f"发现 {len(uniq)} 个 .bin，总 {sum(os.path.getsize(f) for f in uniq)/1e6:.0f} MB")
    out = {"root": ROOT, "files": []}
    for i, f in enumerate(uniq, 1):
        try:
            rec = probe(f)
            out["files"].append(rec)
            print(f"[{i}/{len(uniq)}] {rec['bytes']/1e6:7.1f}MB rec={rec['records']:8d} "
                  f"types={rec['types']:3d} {rec['banner']!r}")
        except Exception as exc:  # noqa: BLE001
            out["files"].append({"file": os.path.relpath(f, ROOT).replace("\\", "/"),
                                 "bytes": os.path.getsize(f), "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{i}/{len(uniq)}] ERROR {f}: {exc}")
        sys.stdout.flush()
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False)
    print(f"写出 {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()

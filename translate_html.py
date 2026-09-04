#!/usr/bin/env python3
"""
Translate ardupilot_wiki sphinx-built HTML to Simplified Chinese. (v2)

策略不变:只收集可见 text 节点 -> JSON 数组分批翻译 -> 原位替换回 DOM。
结构/属性/链接/脚本永不发给 LLM。

v2 针对 deepseek-v4(默认开思考模式)的修复:
- 请求默认带 thinking={"type":"disabled"}:v4 思考默认开启且 effort=high,
  思维链计入 max_tokens 预算,导致 content 截断(Unterminated string)或为空
- finish_reason=="length" 时从半截输出抢救已译元素,续翻剩余部分
- 解析/长度校验失败 -> 自动二分缩小批量重试,兜底保留原文(不整批丢弃)
- 每批增加输入字符上限,双保险控制输出长度
- 过滤无需翻译的 token(纯数字/URL/版本号/标识符)+ 字符串去重
- 文件级多线程并发;429/5xx 指数退避;网关不支持 thinking 参数时自动降级

Usage: DEEPSEEK_API_KEY=sk-xxx python3 translate_html.py <src_dir> <dst_dir> [--force]
Env:
  DEEPSEEK_API_KEY        required
  DEEPSEEK_BASE_URL       default https://api.deepseek.com
  DEEPSEEK_MODEL          default deepseek-v4-flash
  DEEPSEEK_MAX_TOKENS     default 16000
  DEEPSEEK_KEEP_THINKING  =1 时保留思考模式(默认关闭)
  DEEPSEEK_JSON_MODE      =1 时启用 response_format=json_object
  TRANSLATE_WORKERS       default 4(并发文件数)
  BATCH_NODES             default 200(每批节点数上限)
"""

import hashlib
import json
import os
import re
import sys
import time
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString

# ---------------- config ----------------
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
MAX_TOKENS = int(os.environ.get("DEEPSEEK_MAX_TOKENS", "16000"))
KEEP_THINKING = os.environ.get("DEEPSEEK_KEEP_THINKING", "") == "1"
JSON_MODE = os.environ.get("DEEPSEEK_JSON_MODE", "") == "1"
WORKERS = int(os.environ.get("TRANSLATE_WORKERS", "4"))
BATCH_NODES = int(os.environ.get("BATCH_NODES", "200"))
BATCH_CHARS = 6000      # 每批输入字符上限:控制单次输出 token,防截断
MAX_DEPTH = 10          # 二分/续翻最大深度

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else None
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else None
FORCE = "--force" in sys.argv

PRINT_LOCK = threading.Lock()
_THINKING_REJECTED = False   # 网关不支持 thinking 参数时自动降级
_THINK_WARNED = False

# 三个反引号:运行时拼出来,避免源码里出现会破坏 markdown/复制的围栏字符
BK = chr(96) * 3
FENCE_RE = re.compile("^" + BK + r"(?:json)?\s*\n?(.*?)\n?" + BK + r"\s*$", re.DOTALL)
THINK_TAG_RE = re.compile(r"<think>.*?(?:</think>|\Z)", re.DOTALL)
EXT_RE = re.compile(r"\.(?:py|h|hpp|c|cpp|md|html?|txt|xml|json|jpg|jpeg|png|gif|zip|gz|bin|elf|px4|apj)$", re.I)
VERSION_RE = re.compile(r"^v?\d+(?:\.\d+)+[a-z0-9\-]*$", re.I)
SKIP_PARENTS = {"script", "style", "noscript", "title", "head", "template"}

SYSTEM_PROMPT = r"""你是专业无人机/航空技术翻译,把英文 JSON 数组中的每个字符串翻译为简体中文。

## 严格规则
1. 输出必须是 JSON 数组,且 **长度、顺序** 与输入完全一致(逐元素对应)
2. 只翻译字符串内容;专有名词保留:MAVLink、SITL、VTOL、ArduPilot、QGroundControl、Pixhawk、APM、ESC、RC、GPS、IMU 等
3. 数组元素之间 **不要合并、不要拆分、不要省略**
4. 保留数字、参数名、代码片段、URL、文件路径
5. 译文中不要出现半角双引号 ",需要引用时改用中文引号"";反斜杠转义序列(\n 等)原样保留
6. 标题、按钮、链接文字、表格单元格、列表项等都可翻译"""

USER_PROMPT_ARRAY = (
    "将以下 JSON 数组中的每个字符串翻译为简体中文,**严格保持返回 JSON 数组的长度、顺序**"
    "与输入一致,逐元素对应,不要合并/拆分/省略。保留专有名词,译文中不要使用半角双引号。\n\n"
    "输入:\n" + BK + "json\n{content}\n" + BK + "\n\n"
    "只输出 JSON 数组,不要解释、不要 markdown 包装。"
)

USER_PROMPT_OBJECT = (
    "将 JSON 对象里 \"t\" 数组中的每个字符串翻译为简体中文,"
    "严格保持 \"t\" 数组 **长度、顺序** 与输入一致,逐元素对应,不要合并/拆分/省略。"
    "保留专有名词,译文中不要使用半角双引号。\n\n"
    "输入:\n" + BK + "json\n{content}\n" + BK + "\n\n"
    "只输出 JSON 对象 {{\"t\": [\"...\", \"...\"]}},不要解释。"
)


# ---------------- exceptions / logging ----------------
class OutputTruncated(Exception):
    """finish_reason == length:输出被 max_tokens 截断,args[0] 为半截内容"""


class APIHTTPError(Exception):
    def __init__(self, code: int, body: str):
        super().__init__(f"HTTP {code}: {body[:300]}")
        self.code = code


class _NoThinkingSupport(Exception):
    """网关不认识 thinking 参数,需降级重试"""


class PartialResult(Exception):
    def __init__(self, arr: list):
        super().__init__(f"partial: {len(arr)} elems")
        self.arr = arr


def _log(msg: str):
    with PRINT_LOCK:
        print(msg, flush=True)


def _think_hint():
    global _THINK_WARNED
    with PRINT_LOCK:
        if not _THINK_WARNED:
            _THINK_WARNED = True
            print("HINT: 思考内容占用了输出预算(截断/空响应)。本脚本已默认发送 "
                  "thinking={'type':'disabled'} 关闭思考;若仍出现,请调大 "
                  "DEEPSEEK_MAX_TOKENS 或确认网关支持该参数。", flush=True)


# ---------------- API ----------------
def _call_once(messages: list) -> str:
    global _THINKING_REJECTED
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": MAX_TOKENS,
    }
    if JSON_MODE:
        payload["response_format"] = {"type": "json_object"}
    if not KEEP_THINKING and not _THINKING_REJECTED:
        # v4 默认开思考且 effort=high,思维链计入 max_tokens —— 翻译任务直接关掉
        payload["thinking"] = {"type": "disabled"}

    req = urllib.request.Request(
        f"{BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        if e.code == 400 and "thinking" in payload and "thinking" in body.lower():
            _THINKING_REJECTED = True   # 该网关不认识此参数,后续请求不再携带
            raise _NoThinkingSupport(body[:200])
        raise APIHTTPError(e.code, body) from None

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"no choices: {str(data)[:200]}")
    choice = choices[0]
    msg = choice.get("message") or {}
    content = THINK_TAG_RE.sub("", msg.get("content") or "").strip()

    if choice.get("finish_reason") == "length":
        if msg.get("reasoning_content") and not content:
            _think_hint()
        raise OutputTruncated(content)      # 带着半截输出走抢救流程
    if not content:
        if msg.get("reasoning_content"):
            _think_hint()
        raise RuntimeError("empty content")
    return content


def _chat(messages: list, attempts: int = 3) -> str:
    """网络层重试:429/5xx/超时/空响应 退避重试;截断不在此重试(交给上层抢救/二分)。"""
    last = None
    i = 0
    while i < attempts:
        try:
            return _call_once(messages)
        except _NoThinkingSupport as e:
            _log(f"      endpoint rejected thinking param, retry without it: {e}")
            continue                        # 已全局降级,立即重试,不消耗次数
        except OutputTruncated:
            raise
        except APIHTTPError as e:
            i += 1
            last = str(e)
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** (i - 1) + 1)
                _log(f"      api retry {i}/{attempts}: {last}")
                continue
            raise RuntimeError(last) from None   # 4xx 参数/权限问题,重试无意义
        except Exception as e:
            i += 1
            last = f"{type(e).__name__}: {e}"
            _log(f"      api retry {i}/{attempts}: {last}")
            time.sleep(i)
    raise RuntimeError(f"API failed after {attempts} attempts: {last}")


# ---------------- JSON 提取 / 抢救 ----------------
def _extract_json(raw: str):
    """从模型输出中提取 JSON:优先整体解析(数组或 {"t":[...]} 包装),失败则定位首个 [ 之后的内容。"""
    text = raw.strip()
    m = FENCE_RE.match(text)
    if m:
        text = m.group(1).strip()
    try:
        v = json.loads(text, strict=False)
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            for val in v.values():
                if isinstance(val, list):
                    return val
    except Exception:
        pass
    i = text.find("[")
    return text[i:] if i >= 0 else text


def _salvage_array(arr_text: str) -> list:
    """从可能被截断的 JSON 数组文本中,抢救出前面已完整的元素。"""
    if not arr_text.startswith("["):
        return []
    try:
        v, _ = json.JSONDecoder(strict=False).raw_decode(arr_text)
        return v if isinstance(v, list) else []
    except json.JSONDecodeError:
        pass
    # 从尾部往前找引号边界,补 闭合再试(最多回退 60 个引号位置)
    quotes = [mm.start() for mm in re.finditer('"', arr_text)]
    for pos in reversed(quotes[-60:]):
        try:
            v = json.loads(arr_text[:pos] + '"]', strict=False)
            if isinstance(v, list) and v:
                return v
        except Exception:
            continue
    return []


# ---------------- 翻译核心 ----------------
def _request_array(items: list[str]) -> list[str]:
    """调用一次 API,返回与 items 等长的 str 列表;只拿到部分结果时抛 PartialResult。"""
    content = json.dumps(items, ensure_ascii=False)
    user = (USER_PROMPT_OBJECT if JSON_MODE else USER_PROMPT_ARRAY).format(content=content)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
    try:
        raw = _chat(messages)
    except OutputTruncated as e:
        raw = e.args[0] if e.args else ""   # 截断 -> 拿半截输出去抢救

    got = _extract_json(raw)
    if isinstance(got, list):
        arr = got
    else:
        try:
            arr = json.loads(got, strict=False)   # strict=False 容忍字符串内控制字符
        except Exception:
            arr = _salvage_array(got)
    if not isinstance(arr, list):
        raise RuntimeError(f"not a JSON array, head={raw[:120]!r}")
    arr = ["" if x is None else str(x) for x in arr]
    if len(arr) >= len(items):
        return arr[: len(items)]
    raise PartialResult(arr)


def _translate_items(items: list[str], depth: int = 0) -> list[str]:
    """返回与 items 等长:部分成功 -> 续翻尾部;失败 -> 二分缩小;最终兜底保留原文。"""
    if not items:
        return []
    fail: Exception = RuntimeError("unknown")
    try:
        return _request_array(items)
    except PartialResult as p:
        if p.arr:
            _log(f"      partial: {len(p.arr)}/{len(items)} salvaged, continue tail ...")
            return p.arr + _translate_items(items[len(p.arr):], depth)
        fail = RuntimeError(f"salvaged 0/{len(items)} elements")
    except Exception as e:
        fail = e
    if len(items) == 1 or depth >= MAX_DEPTH:
        _log(f"      give up x{len(items)}, keep EN: {fail}")
        return list(items)
    mid = len(items) // 2
    _log(f"      bisect {len(items)} -> {mid}+{len(items) - mid}: {fail}")
    return _translate_items(items[:mid], depth + 1) + _translate_items(items[mid:], depth + 1)


# ---------------- 批次 / 过滤 ----------------
def _make_batches(items: list[str]):
    batch: list[str] = []
    chars = 0
    for s in items:
        if batch and (len(batch) >= BATCH_NODES or chars >= BATCH_CHARS):
            yield batch
            batch, chars = [], 0
        batch.append(s)
        chars += len(s)
    if batch:
        yield batch


def _needs_translation(text: str) -> bool:
    if not re.search(r"[A-Za-z]", text):
        return False                     # 纯数字/标点/符号
    if text.startswith(("http://", "https://", "www.")):
        return False                     # URL
    if VERSION_RE.match(text):
        return False                     # 4.2.3 / v2.0.1
    if " " not in text and ("_" in text or "::" in text or EXT_RE.search(text)):
        return False                     # 标识符/文件路径:MAV_TYPE_xxx、uint8_t、xxx.html
    return True


def _collect_text_nodes(soup: BeautifulSoup):
    """[(node, pre_ws, text, post_ws)];text 为 strip 后文本,替换时保留首尾空白。"""
    body = soup.find("body") or soup
    entries = []
    for elem in body.find_all(string=True):
        if type(elem) is not NavigableString:    # 精确类型,排除 Comment/Doctype 等子类
            continue
        parent = elem.parent
        if parent and parent.name in SKIP_PARENTS:
            continue
        raw = str(elem)
        text = raw.strip()
        if len(text) < 2:
            continue
        if "<" in text or "&lt;" in text or "&gt;" in text:
            continue
        pre = raw[: len(raw) - len(raw.lstrip())]
        post = raw[len(raw.rstrip()):]
        entries.append((elem, pre, text, post))
    return entries


def translate_html(html: str, tag: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    entries = _collect_text_nodes(soup)
    if not entries:
        return html

    todo_idx = [i for i, e in enumerate(entries) if _needs_translation(e[2])]
    uniq = list(dict.fromkeys(entries[i][2] for i in todo_idx))   # 去重保序
    _log(f"[{tag}] nodes={len(entries)} to_translate={len(todo_idx)} unique={len(uniq)}")

    mapping: dict[str, str] = {}
    batches = list(_make_batches(uniq))
    for bi, batch in enumerate(batches, 1):
        res = _translate_items(batch)
        for src, new in zip(batch, res):
            mapping[src] = new if new.strip() else src
        _log(f"[{tag}] batch {bi}/{len(batches)} done ({len(batch)})")

    for i in todo_idx:
        node, pre, text, post = entries[i]
        node.replace_with(NavigableString(pre + mapping.get(text, text) + post))
    return str(soup)


# ---------------- 文件级并发 ----------------
def process_file(f: Path):
    rel = f.relative_to(SRC)
    out = DST / rel
    hash_file = out.with_name(out.name + ".hash")   # 增量缓存:目标 .html 旁的 .hash

    # 增量:源 .html hash 未变 → skip
    src_hash = hashlib.sha256(f.read_bytes()).hexdigest()[:16]
    if not FORCE and out.exists() and hash_file.exists() \
            and hash_file.read_text().strip() == src_hash:
        return "skip", rel, ""

    html = f.read_text(encoding="utf-8", errors="replace")
    if len(html) < 200:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        hash_file.write_text(src_hash)
        return "cp", rel, ""
    try:
        zh = translate_html(html, rel.as_posix())
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(zh, encoding="utf-8")
        hash_file.write_text(src_hash)
        return "ok", rel, ""
    except Exception as e:
        # 失败时清掉 .hash,下次重试
        hash_file.unlink(missing_ok=True)
        return "fail", rel, str(e)


def main() -> int:
    if not API_KEY:
        print("ERROR: DEEPSEEK_API_KEY env not set", file=sys.stderr)
        return 1
    if SRC is None or DST is None:
        print("usage: python3 translate_html.py <src_dir> <dst_dir> [--force]", file=sys.stderr)
        return 1
    if not SRC.is_dir():
        print(f"ERROR: {SRC} not found", file=sys.stderr)
        return 1
    DST.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in SRC.rglob("*.html") if p.is_file())
    total = len(files)
    print(f"=== {total} html | model={MODEL} workers={WORKERS} "
          f"batch<={BATCH_NODES}nodes/{BATCH_CHARS}chars "
          f"thinking={'keep' if KEEP_THINKING else 'off'} json_mode={JSON_MODE} ===", flush=True)

    counts = {"ok": 0, "cp": 0, "skip": 0, "fail": 0}
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(process_file, f) for f in files]
        for i, fut in enumerate(as_completed(futs), 1):
            status, rel, err = fut.result()
            counts[status] += 1
            line = f"[{i}/{total}] {status.upper()} {rel}"
            if err:
                line += f": {err}"
                failures.append(f"{rel}: {err}")
            _log(line)

    print(f"\n=== done={counts['ok'] + counts['cp']} skipped={counts['skip']} "
          f"failed={counts['fail']} total={total} ===")
    for msg in failures:
        print(f" FAIL {msg}")
    return 0 if not failures else 2


if __name__ == "__main__":
    sys.exit(main())

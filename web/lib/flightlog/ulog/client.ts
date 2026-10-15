/**
 * 主线程客户端：接 File / ArrayBuffer → ULog 解析（默认 Worker，无 Worker 环境退化为主线程）。
 *
 * 与 DataFlash 客户端同形（`ParseLogFileResult` 同构），这样 `runDiagnosis` 的按格式路由
 * 只需替换"调哪个解析器"，下游统计/警告/UI 全都不用改。
 */

import type { LogDocument } from "../types/log";
import type { ParseLogFileResult, ParseLogOptions, ParseProgress } from "../dataflash/client";
import { parseUlog, type UlogParseResult } from "./parseUlog";
import type { UlogWorkerReply } from "./worker";

export type { ParseLogFileResult, ParseLogOptions, ParseProgress };

async function toBytes(source: File | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}

function parseInProcess(bytes: Uint8Array, options: ParseLogOptions): ParseLogFileResult {
  const result = parseUlog(bytes, {
    onProgress: (percent) => {
      options.onProgress?.({ phase: "parsing", percent, message: `解析 PX4 ULog：${percent}%` });
    },
  });
  options.onProgress?.({
    phase: "done",
    percent: 100,
    message: `解析完成：${result.stats.records} 条记录，${result.warnings.length} 条警告`,
  });
  return narrow(result);
}

/**
 * 解析 ULog → LogDocument + 解析诊断数据。
 * ⚠️ 与 DataFlash 不同：ULog 的头部/不兼容标志错误**会抛**（不是"这不像 ULog"的模糊失败），
 * 因为 .ulg 的魔术头已经被路由层确认过，此时抛出的都是可读的具体原因。
 */
export async function parseUlogFile(
  source: File | ArrayBuffer | Uint8Array,
  options: ParseLogOptions = {},
): Promise<ParseLogFileResult> {
  const bytes = await toBytes(source);
  options.onProgress?.({ phase: "parsing", percent: 0, message: "读取日志字节…" });
  if (options.signal?.aborted) throw new DOMException("解析已取消", "AbortError");

  if (options.forceMainThread === true || typeof Worker === "undefined") {
    return parseInProcess(bytes, options);
  }

  return new Promise<ParseLogFileResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(parseInProcess(bytes, options));
      return;
    }
    const abort = (): void => {
      worker.terminate();
      reject(new DOMException("解析已取消", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    worker.onmessage = (event: MessageEvent<UlogWorkerReply>) => {
      const reply = event.data;
      if (reply.type === "progress") {
        options.onProgress?.({ phase: "parsing", percent: reply.percent, message: `解析 PX4 ULog：${reply.percent}%` });
        return;
      }
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (reply.type === "error") {
        reject(new Error(reply.message));
        return;
      }
      options.onProgress?.({
        phase: "done",
        percent: 100,
        message: `解析完成：${reply.stats.records} 条记录，${reply.warnings.length} 条警告`,
      });
      resolve({
        doc: reply.doc as LogDocument,
        warnings: reply.warnings,
        stats: reply.stats,
      });
    };
    worker.onerror = (event) => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      reject(new Error(event.message || "ULog worker 执行失败"));
    };

    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    worker.postMessage({ type: "parse", id: 1, buffer }, [buffer]);
  });
}

function narrow(result: UlogParseResult): ParseLogFileResult {
  return { doc: result.doc, warnings: result.warnings, stats: result.stats };
}

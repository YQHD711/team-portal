/**
 * 主线程客户端：接 File / ArrayBuffer，交给 Worker 解析，向上报进度、返回 LogDocument。
 *
 * 两条路径（同一份纯函数，行为一致）：
 *  - 默认：spawn worker.ts（大文件不卡 UI），支持 AbortSignal 取消（terminate）；
 *  - 兜底：环境里没有 Worker（离线 vitest、SSR、老浏览器）时**同步解析**，不静默失败也不报错。
 */

import type { LogDocument } from "../types/log";
import { parseDataflash, type DataflashParseResult, type ParseOptions } from "./parseDataflash";
import type { WorkerReply } from "./worker";

export type ParsePhase = "parsing" | "done";

export interface ParseProgress {
  phase: ParsePhase;
  /** 0..100 */
  percent: number;
  message: string;
}

export interface ParseLogOptions {
  onProgress?: (progress: ParseProgress) => void;
  signal?: AbortSignal;
  /** 强制走主线程（测试/SSR 用） */
  forceMainThread?: boolean;
}

async function toBytes(source: File | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}

function parseInProcess(bytes: Uint8Array, options: ParseLogOptions): DataflashParseResult {
  const parseOptions: ParseOptions = {
    onProgress: (percent) => {
      options.onProgress?.({ phase: "parsing", percent, message: `解析 DataFlash：${percent}%` });
    },
  };
  const result = parseDataflash(bytes, parseOptions);
  options.onProgress?.({
    phase: "done",
    percent: 100,
    message: `解析完成：${result.stats.records} 条记录，${result.warnings.length} 条警告`,
  });
  return result;
}

/**
 * 解析日志文件 → LogDocument。
 * 解析失败（文件根本不像 DataFlash）不抛异常：返回带 warning 的空文档，让 UI 明确提示。
 */
export async function parseLogFile(
  source: File | ArrayBuffer | Uint8Array,
  options: ParseLogOptions = {},
): Promise<LogDocument> {
  const bytes = await toBytes(source);
  options.onProgress?.({ phase: "parsing", percent: 0, message: "读取日志字节…" });
  if (options.signal?.aborted) throw new DOMException("解析已取消", "AbortError");

  if (options.forceMainThread === true || typeof Worker === "undefined") {
    return parseInProcess(bytes, options).doc;
  }

  return new Promise<LogDocument>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(parseInProcess(bytes, options).doc);
      return;
    }
    const requestId = 1;
    const abort = (): void => {
      worker.terminate();
      reject(new DOMException("解析已取消", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === "progress") {
        options.onProgress?.({ phase: "parsing", percent: reply.percent, message: `解析 DataFlash：${reply.percent}%` });
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
      resolve(reply.doc as LogDocument);
    };
    worker.onerror = (event) => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      reject(new Error(event.message || "DataFlash worker 执行失败"));
    };

    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    worker.postMessage({ type: "parse", id: requestId, buffer }, [buffer]);
  });
}

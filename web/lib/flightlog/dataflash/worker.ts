/**
 * DataFlash 解析的 Worker 薄壳（**不含任何解析逻辑**，逻辑全在 parseDataflash.ts 的纯函数里）。
 *
 * 主线程用 `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` 创建本 Worker，
 * 发 `{ type: "parse", buffer, id }`，收 `{ type: "progress" | "done" | "error" }`。
 * 之所以薄：解析器必须能在 vitest 里直接调用（不依赖 self / worker 生命周期），本文件只做消息搬运。
 */

import { parseDataflash } from "./parseDataflash";

interface ParseRequest {
  type: "parse";
  id: number;
  buffer: ArrayBuffer;
}

interface DoneReply {
  type: "done";
  id: number;
  doc: unknown;
  warnings: readonly string[];
  stats: { records: number; skippedBytes: number; t0us: number; elapsedMs: number };
}

interface ProgressReply {
  type: "progress";
  id: number;
  percent: number;
}

interface ErrorReply {
  type: "error";
  id: number;
  message: string;
}

export type WorkerReply = DoneReply | ProgressReply | ErrorReply;

/** Worker 作用域的最小接口（避免依赖 DOM lib 里的 Worker 全局类型）。 */
export interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: WorkerReply): void;
}

export function handleParseRequest(event: MessageEvent<ParseRequest>, scope: WorkerScope): void {
  const { id, buffer } = event.data;
  try {
    const result = parseDataflash(new Uint8Array(buffer), {
      onProgress: (percent) => scope.postMessage({ type: "progress", id, percent }),
    });
    scope.postMessage({
      type: "done", id, doc: result.doc, warnings: result.warnings, stats: result.stats,
    });
  } catch (error) {
    scope.postMessage({
      type: "error", id, message: error instanceof Error ? error.message : String(error),
    });
  }
}

// 真实 Worker 环境：self 既是 scope 又是事件源
const workerSelf = globalThis as unknown as WorkerScope & {
  addEventListener(type: "message", listener: (event: MessageEvent<ParseRequest>) => void): void;
};
if (typeof (workerSelf as { postMessage?: unknown }).postMessage === "function") {
  workerSelf.onmessage = (event) => handleParseRequest(event, workerSelf);
}

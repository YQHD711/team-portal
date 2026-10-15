/**
 * ULog 解析的 Worker 薄壳（**不含解析逻辑**，逻辑全在 parseUlog.ts 的纯函数里）。
 *
 * 与 DataFlash 的 worker 同协议：发 `{ type:"parse", buffer, id }`，
 * 收 `{ type:"progress" | "done" | "error" }`。之所以薄：解析器必须能在 vitest 里直接调用。
 */

import { parseUlog, type UlogParseResult } from "./parseUlog";

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
  stats: UlogParseResult["stats"];
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

export type UlogWorkerReply = DoneReply | ProgressReply | ErrorReply;

/** Worker 作用域的最小接口（避免依赖 DOM lib 的 Worker 全局类型） */
export interface UlogWorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: UlogWorkerReply): void;
}

export function handleUlogParseRequest(event: MessageEvent<ParseRequest>, scope: UlogWorkerScope): void {
  const { id, buffer } = event.data;
  try {
    const result = parseUlog(new Uint8Array(buffer), {
      onProgress: (percent) => scope.postMessage({ type: "progress", id, percent }),
    });
    scope.postMessage({ type: "done", id, doc: result.doc, warnings: result.warnings, stats: result.stats });
  } catch (error) {
    scope.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const workerSelf = globalThis as unknown as UlogWorkerScope & {
  addEventListener(type: "message", listener: (event: MessageEvent<ParseRequest>) => void): void;
};
if (typeof (workerSelf as { postMessage?: unknown }).postMessage === "function") {
  workerSelf.onmessage = (event) => handleUlogParseRequest(event, workerSelf);
}

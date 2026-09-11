/**
 * 带鉴权与进度的流式下载（从 lib/api.ts 拆出，避免单文件超 200 行）。
 * 对外入口仍是 api.download，调用方不需要知道这里的细节。
 */

import { API_BASE, isBrowser } from "./api-base";

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const IDLE_TIMEOUT = 60000; // 读空闲超时：这么久没有字节才算断流

/** 下载进度。total 为 null 表示服务端未声明长度（分块传输），此时只能显示不确定态。 */
export interface DownloadProgress {
  received: number;
  total: number | null;
}

export interface DownloadOptions {
  /** 只约束「拿到响应头」这一段；拿到后改由 idleMs 看读空闲 */
  timeoutMs?: number;
  /** 读空闲超时：大文件传输本就不该有总时长上限，但也不能对断流永久等待 */
  idleMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
  /** 调用方取消（如「取消下载」按钮） */
  signal?: AbortSignal;
}

function declaredTotal(header: string | null): number | null {
  const value = Number(header);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 逐块读响应体并回调进度，最后拼成 Blob 交给调用方另存。
 * 超时分两段：timeoutMs 只管响应头阶段，之后按 idleMs 看读空闲。
 */
export async function downloadWithProgress(endpoint: string, options: DownloadOptions = {}): Promise<Blob> {
  const { timeoutMs = DEFAULT_TIMEOUT, idleMs = IDLE_TIMEOUT, onProgress, signal } = options;
  const token = isBrowser() ? localStorage.getItem("token") : null;
  const controller = new AbortController();
  let abortReason: "timeout" | "idle" | "cancel" | null = null;
  const abortWith = (reason: typeof abortReason) => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    controller.abort();
  };
  const onExternalAbort = () => abortWith("cancel");
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  let headerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => abortWith("timeout"), timeoutMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = idleMs > 0 ? setTimeout(() => abortWith("idle"), idleMs) : null;
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal,
    });
    if (headerTimer) {
      clearTimeout(headerTimer);
      headerTimer = null;
    }

    if (res.status === 401 && isBrowser()) {
      localStorage.removeItem("token");
      window.location.href = "/auth/login";
      throw new Error("登录已过期，请重新登录");
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: `下载失败 (${res.status})` }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    const total = declaredTotal(res.headers.get("Content-Length"));
    if (!res.body) {
      const blob = await res.blob();
      onProgress?.({ received: blob.size, total });
      return blob;
    }

    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    onProgress?.({ received, total });
    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // 复制一份：reader 给的是 Uint8Array<ArrayBufferLike>，BlobPart 要求 ArrayBuffer 视图
        chunks.push(new Uint8Array(value));
        received += value.byteLength;
        onProgress?.({ received, total });
      }
      armIdle();
    }
    return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "application/octet-stream" });
  } catch (err) {
    if (abortReason === "timeout") throw new Error("请求超时，请检查网络连接");
    if (abortReason === "idle") throw new Error("下载中断：长时间没有收到数据");
    if (abortReason === "cancel") throw new Error("已取消下载");
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("下载已中断");
    throw err;
  } finally {
    if (headerTimer) clearTimeout(headerTimer);
    if (idleTimer) clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

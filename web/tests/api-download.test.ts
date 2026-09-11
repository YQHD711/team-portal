import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadWithProgress } from "@/lib/api-download";

/** 造一个只有下载逻辑用到的那几个成员的最小 Response。 */
function fakeResponse(
  chunks: Uint8Array[],
  opts: { contentLength?: number; contentType?: string } = {}
): Response {
  let index = 0;
  const headers: Record<string, string | null> = {
    "content-length": opts.contentLength === undefined ? null : String(opts.contentLength),
    "content-type": opts.contentType ?? "application/octet-stream",
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

/** fetch 在 signal 被 abort 时以 AbortError 拒绝（贴近真实行为，否则超时用例会永远挂着）。 */
function hangingFetch(): typeof fetch {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError"))
      );
    })
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api.download 流式下载", () => {
  it("逐块回调进度并拼出完整 Blob", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])], { contentLength: 5 })));
    const seen: { received: number; total: number | null }[] = [];

    const blob = await downloadWithProgress("/api/firmware/download?x=1", { onProgress: p => seen.push({ ...p }) });

    expect(blob.size).toBe(5);
    expect(seen.map(s => s.received)).toEqual([0, 3, 5]);
    expect(seen.every(s => s.total === 5)).toBe(true);
  });

  it("服务端未声明长度时 total 为 null（前端显示不确定态）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse([new Uint8Array([1, 2])])));
    const seen: { received: number; total: number | null }[] = [];

    await downloadWithProgress("/api/x", { onProgress: p => seen.push({ ...p }) });

    expect(seen[seen.length - 1]).toEqual({ received: 2, total: null });
  });

  it("非 2xx 时透出后端的问题描述，而不是笼统的 HTTP 码", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ detail: "固件下载失败，请稍后重试" }),
    } as unknown as Response));

    await expect(downloadWithProgress("/api/x")).rejects.toThrow("固件下载失败，请稍后重试");
  });

  it("调用方取消时给出「已取消下载」", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();

    const pending = downloadWithProgress("/api/x", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow("已取消下载");
  });

  it("响应头阶段超时后按超时文案报错", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const pending = downloadWithProgress("/api/x", { timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toThrow("请求超时，请检查网络连接");
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
  });
});

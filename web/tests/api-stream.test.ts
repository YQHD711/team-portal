import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";

/**
 * api.stream 的超时语义：timeoutMs 只约束「拿到响应头」，
 * 拿到后必须清除定时器 —— 否则 30s 后 abort() 会在读 body 中途掐断 AI 长回答。
 */
describe("api.stream 超时语义", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem("token", "test-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("拿到响应头后不再被默认 30s 超时中断（回归：长回答被截断）", async () => {
    let signal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({ start() { /* 保持打开，模拟 SSE 长连接 */ } });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(stream, { status: 200 });
    }));

    const res = await api.stream("/api/ai/chat", { question: "复杂问题" });

    expect(res.status).toBe(200);
    expect(signal?.aborted).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(signal?.aborted).toBe(false); // 旧实现此处已 abort → 流被掐断
  });

  it("响应头迟迟不来时仍然超时中止并给出中文提示", async () => {
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    })));

    const pending = api.stream("/api/ai/chat", { question: "hi" });
    const assertion = expect(pending).rejects.toThrow(/请求超时/);
    vi.advanceTimersByTime(31_000);
    await assertion;
    expect(aborted).toBe(true);
  });

  it("HTTP 错误码仍然抛错（不因去掉定时器而吞掉失败）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));

    await expect(api.stream("/api/ai/chat", { question: "hi" })).rejects.toThrow(/HTTP 502/);
  });
});

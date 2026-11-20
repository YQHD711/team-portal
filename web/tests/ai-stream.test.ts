import { describe, it, expect } from "vitest";
import {
  AiStreamError,
  consumeAiStream,
  httpErrorMessage,
  toAiStreamError,
} from "@/lib/ai-stream";

/**
 * AI 流式消费层的回归测试。
 *
 * 这些用例对应线上的三个真实故障：
 * ① 上游 503/429/401 全被显示成「AI 服务暂不可用」→ 状态码必须能翻译成可读提示；
 * ② 上游挂起时界面永远转圈 → 空闲超时必须中断；
 * ③ 流中途失败只留半截回答、没有任何提示 → 必须识别后端 event: error 帧。
 */

/** 用给定的 SSE 文本片段构造一个 200 响应 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("httpErrorMessage", () => {
  it("把常见状态码翻译成用户能看懂的中文", () => {
    expect(httpErrorMessage(401)).toContain("登录已过期");
    expect(httpErrorMessage(429)).toContain("频繁");
    expect(httpErrorMessage(503)).toContain("暂不可用");
    expect(httpErrorMessage(504)).toContain("超时");
  });
});

describe("toAiStreamError", () => {
  it("还原 api.stream 抛出的带 status 的 HTTP 错误", () => {
    const err = Object.assign(new Error("HTTP 503"), { status: 503 });
    const e = toAiStreamError(err);
    expect(e).toBeInstanceOf(AiStreamError);
    expect(e.kind).toBe("unavailable");
    expect(e.message).toContain("暂不可用");
  });

  it("区分限流与登录过期（不再一律「服务不可用」）", () => {
    expect(toAiStreamError(Object.assign(new Error("HTTP 429"), { status: 429 })).kind).toBe("rate");
    expect(toAiStreamError(Object.assign(new Error("HTTP 401"), { status: 401 })).kind).toBe("auth");
  });

  it("AbortError 归为已取消，TypeError 归为网络错误", () => {
    expect(toAiStreamError(new DOMException("Aborted", "AbortError")).kind).toBe("aborted");
    expect(toAiStreamError(new TypeError("Failed to fetch")).kind).toBe("network");
  });
});

describe("consumeAiStream", () => {
  it("逐段回调 delta.content 并返回完整正文", async () => {
    const deltas: string[] = [];
    const full = await consumeAiStream(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      { onDelta: (chunk) => deltas.push(chunk) },
    );
    expect(deltas).toEqual(["你", "好"]);
    expect(full).toBe("你好");
  });

  it("中文被 chunk 边界切开也能正确解码（TextDecoder stream 模式）", async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('data: {"choices":[{"delta":{"content":"电池"}}]}\n\n');
    // 故意在 UTF-8 三字节汉字中间切开
    const head = payload.slice(0, 16);
    const tail = payload.slice(16);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
        controller.enqueue(tail);
        controller.close();
      },
    });
    const full = await consumeAiStream(new Response(stream, { status: 200 }), {
      onDelta: () => {},
    });
    expect(full).toBe("电池");
  });

  it("识别 event: error 帧并抛错，同时回调 onStreamError", async () => {
    const errors: string[] = [];
    const p = consumeAiStream(
      sseResponse(['event: error\ndata: {"error":"AI 响应中断，请重试"}\n\n']),
      { onDelta: () => {}, onStreamError: (m) => errors.push(m) },
    );
    await expect(p).rejects.toThrow("AI 响应中断");
    expect(errors).toEqual(["AI 响应中断，请重试"]);
  });

  it("非 2xx 响应抛 AiStreamError 并按状态码分类", async () => {
    await expect(
      consumeAiStream(new Response("nope", { status: 503 }), { onDelta: () => {} }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("空闲超时会中断并给出超时提示（不会永远转圈）", async () => {
    // 用假 reader 而不是真 ReadableStream：jsdom 的流在无数据时会立刻 done，
    // 测不到「上游挂起」这个场景。read() 返回永不 resolve 的 promise 才等价于卡住。
    const stuckReader = {
      read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
      cancel: async () => {},
    };
    const stuckResponse = {
      ok: true,
      body: { getReader: () => stuckReader },
    } as unknown as Response;

    const p = consumeAiStream(stuckResponse, { onDelta: () => {}, idleTimeoutMs: 50 });
    await expect(p).rejects.toMatchObject({ kind: "timeout" });
    await expect(p).rejects.toThrow(/没有返回内容/);
  }, 10_000);
});

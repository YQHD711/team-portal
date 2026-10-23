import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createAgentSseParser, interpretAgentEvent, parseAgentSseFrame, parseProviderDelta } from "@/components/admin/ai-admin/agentStream";
import AIAdminPage from "@/app/(protected)/admin/ai-admin/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), stream: vi.fn() },
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedStream = vi.mocked(api.stream);

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("AI 管理员 SSE 解析", () => {
  it("按空行切帧，支持帧跨 chunk 到达", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createAgentSseParser(e => events.push(e));

    feed('event: status\ndata: {"phase":"round","round":1,"message":"第 1 轮：等待模型分析…"}');
    expect(events).toHaveLength(0); // 还没有空行 → 帧没结束
    feed("\n\n");

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("status");
    expect(interpretAgentEvent(events[0]).status).toBe("第 1 轮：等待模型分析…");
  });

  it("provider 原生分片只取 delta.content，[DONE] 与坏 JSON 被忽略", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createAgentSseParser(e => events.push(e));
    feed('data: {"choices":[{"delta":{"content":"结论："}}]}\n\n');
    feed('data: {"choices":[{"delta":{"content":"一切正常"}}]}\n\ndata: [DONE]\n\n');

    const deltas = events.map(interpretAgentEvent).map(u => u.delta ?? "").filter(Boolean);
    expect(deltas.join("")).toBe("结论：一切正常");
    expect(parseProviderDelta("[DONE]")).toBe("");
    expect(parseProviderDelta("不是 JSON")).toBe("");
    expect(parseProviderDelta('{"choices":[{"delta":{"reasoning_content":"思考"}}]}')).toBe("");
  });

  it("status / done / error 事件映射为界面状态", () => {
    const status = interpretAgentEvent({ event: "status", data: '{"phase":"tool","tools":["read_logs"],"message":"已调用：read_logs"}' });
    expect(status.status).toBe("已调用：read_logs");

    const done = interpretAgentEvent({ event: "done", data: '{"stats":{"total":4,"summaries":1,"byRole":[]}}' });
    expect(done.stats).toEqual({ total: 4, summaries: 1, byRole: [] });

    const error = interpretAgentEvent({ event: "error", data: '{"message":"❌ API 错误 (500): boom"}' });
    expect(error.error).toContain("API 错误");

    expect(parseAgentSseFrame("event: status")).toBeNull(); // 无 data 行的帧忽略
    expect(interpretAgentEvent({ event: "message", data: "不是 JSON" })).toEqual({});
  });
});

describe("AI 管理员页面流式渲染", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 没有实现 scrollIntoView（页面加载后会自动滚到底部）
    Element.prototype.scrollIntoView = vi.fn();
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/admin/agent/status") return { busy: false };
      if (endpoint === "/api/admin/agent/memory") return { total: 2, summaries: 0, byRole: [] };
      return [];
    });
  });

  it("增量追加 assistant 消息，done 刷新记忆，调用带取消信号的流式端点", async () => {
    mockedStream.mockResolvedValue(sseResponse([
      'event: status\ndata: {"phase":"round","round":1,"message":"第 1 轮：等待模型分析…"}\n\n',
      'data: {"choices":[{"delta":{"content":"结论："}}]}\n\ndata: {"choices":[{"delta":{"content":"一切正常"}}]}\n\n',
      'event: done\ndata: {"stats":{"total":4,"summaries":0,"byRole":[]}}\n\n',
    ]));

    render(<AIAdminPage />);
    fireEvent.click(screen.getByText("系统健康巡检"));

    await waitFor(() => expect(screen.getByText(/一切正常/)).toBeInTheDocument());
    expect(mockedStream).toHaveBeenCalledWith(
      "/api/admin/agent/analyze/stream",
      expect.objectContaining({ task: expect.any(String) }),
      expect.any(Number),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText(/连续记忆 · 4 条消息/)).toBeInTheDocument());
  });

  it("服务端 error 事件显示可读错误（不卡在 loading）", async () => {
    mockedStream.mockResolvedValue(sseResponse([
      'event: error\ndata: {"message":"❌ API 错误 (500): boom"}\n\n',
      'event: done\ndata: {"stats":{"total":0,"summaries":0,"byRole":[]}}\n\n',
    ]));

    render(<AIAdminPage />);
    fireEvent.click(screen.getByText("排查最近报错"));

    await waitFor(() => expect(screen.getByText(/API 错误 \(500\)/)).toBeInTheDocument());
  });

  it("网络超时给出中文提示", async () => {
    mockedStream.mockRejectedValue(new Error("请求超时，请检查网络连接"));

    render(<AIAdminPage />);
    fireEvent.click(screen.getByText("备份是否正常"));

    await waitFor(() => expect(screen.getByText(/连接超时/)).toBeInTheDocument());
  });
});
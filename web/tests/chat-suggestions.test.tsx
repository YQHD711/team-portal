import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { FALLBACK_SUGGESTIONS } from "@/lib/aiSuggestions";

/**
 * 空会话的建议问题：内容来自 `GET /api/ai/suggestions`，接口不在/返回乱七八糟时用通用兜底。
 * 重点：绝不出现写死的具体实体（「1030 库房」「双频段数传」这类线上根本没有的文档）。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/brand", () => ({
  useBrand: () => ({ teamSubtitle: "航模队", teamName: "雏鹰之翼", refresh: vi.fn() }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

/** 聊天面板另有几个直接 fetch 的会话接口（本任务不动），给个最小替身免得走真实网络 */
function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("new-session") ? { sessionId: "s1" } : []),
  })));
}

const OLD_HARDCODED = ["1030 库房的货架分布？", "某物料还剩多少？", "查《双频段数传》参数", "如何领用 B 级物料？"];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // jsdom 没实现 scrollIntoView（聊天面板挂载后会滚到底部）
  Element.prototype.scrollIntoView = vi.fn();
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

const chipTexts = async () => (await screen.findAllByTestId("ai-suggestion")).map(c => c.textContent);
const input = () => screen.getByPlaceholderText("输入问题...");

describe("聊天页建议问题", () => {
  it("接口返回 2 条 → 只渲染这 2 条，且旧写死的问题一个都不出现", async () => {
    mockedGet.mockResolvedValue({ suggestions: [{ text: "甲问题", kind: "doc" }, { text: "乙问题", kind: "study" }] });
    render(<ChatPanel />);

    expect(await chipTexts()).toEqual(["甲问题", "乙问题"]);
    expect(mockedGet).toHaveBeenCalledWith("/api/ai/suggestions");
    for (const old of OLD_HARDCODED) expect(screen.queryByText(old)).not.toBeInTheDocument();
  });

  it("接口 500：显示通用兜底问题，页面不崩", async () => {
    mockedGet.mockRejectedValue(new Error("HTTP 500"));
    render(<ChatPanel />);

    expect(await chipTexts()).toEqual(FALLBACK_SUGGESTIONS.map(s => s.text));
    expect(input()).toBeInTheDocument();   // 面板还在
  });

  it("接口返回空数组 / 字段不合法：同样走兜底", async () => {
    mockedGet.mockResolvedValueOnce({ suggestions: [] });
    const first = render(<ChatPanel />);
    expect(await chipTexts()).toEqual(FALLBACK_SUGGESTIONS.map(s => s.text));
    first.unmount();

    mockedGet.mockResolvedValueOnce({ suggestions: [{ text: 42 }, { nope: true }, null] });
    render(<ChatPanel />);
    expect(await chipTexts()).toEqual(FALLBACK_SUGGESTIONS.map(s => s.text));
  });

  it("加载完成前不渲染任何 chip（不先闪写死的问题再替换）", () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    render(<ChatPanel />);

    expect(screen.queryByTestId("ai-suggestions")).not.toBeInTheDocument();
    for (const old of OLD_HARDCODED) expect(screen.queryByText(old)).not.toBeInTheDocument();
  });

  it("三种 kind 的图标各不相同；缺失 / 未知 kind 按 doc 处理且不崩", async () => {
    mockedGet.mockResolvedValue({
      suggestions: [
        { text: "文档题", kind: "doc" },
        { text: "学习题", kind: "study" },
        { text: "库存题", kind: "inventory" },
        { text: "缺 kind" },
        { text: "怪 kind", kind: "wat" },
      ],
    });
    render(<ChatPanel />);
    await screen.findAllByTestId("ai-suggestion");

    const chipOf = (text: string) => screen.getAllByTestId("ai-suggestion").find(c => c.textContent === text)!;
    // 三种 kind 各有各的图标（用 data-testid 区分，比 class 稳）
    expect(within(chipOf("文档题")).getByTestId("suggestion-icon-doc")).toBeInTheDocument();
    expect(within(chipOf("学习题")).getByTestId("suggestion-icon-study")).toBeInTheDocument();
    expect(within(chipOf("库存题")).getByTestId("suggestion-icon-inventory")).toBeInTheDocument();
    // inventory 与 doc 的图标不是同一个
    expect(chipOf("库存题").querySelector('[data-testid="suggestion-icon-doc"]')).toBeNull();
    // 缺失 / 未知 → doc
    expect(within(chipOf("缺 kind")).getByTestId("suggestion-icon-doc")).toBeInTheDocument();
    expect(within(chipOf("怪 kind")).getByTestId("suggestion-icon-doc")).toBeInTheDocument();
  });

  it("点 chip 的行为不变：填进输入框（不直接发送）", async () => {
    mockedGet.mockResolvedValue({ suggestions: [{ text: "知识库里有哪些资料？", kind: "doc" }] });
    render(<ChatPanel />);
    await screen.findAllByTestId("ai-suggestion");

    fireEvent.click(screen.getByTestId("ai-suggestion"));

    await waitFor(() => expect(input()).toHaveValue("知识库里有哪些资料？"));
    // 没有发消息：欢迎语还在、没有用户气泡
    expect(screen.getByText(/问我任何关于航模队的问题/)).toBeInTheDocument();
  });
});

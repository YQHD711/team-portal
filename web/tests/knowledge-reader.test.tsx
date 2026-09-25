import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KnowledgeReaderPage from "@/app/(protected)/knowledge/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedUser = vi.mocked(useCurrentUser);

const DOC = "公共/资料/航模入门.md";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", `/knowledge?path=${encodeURIComponent(DOC)}`);
  mockedUser.mockReturnValue({ user: { id: 2, username: "队员", role: "member", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
});

/**
 * 只读阅读页存在的理由：知识库编辑器在 /admin/knowledge 下，AuthGuard 会把非 staff
 * 从 /admin/* 踢回首页 —— 队员从搜索点进来只能落在首页，等于搜到了也打不开。
 */
describe("知识库只读阅读页", () => {
  it("按 ?path= 取正文并渲染（队员也能打开）", async () => {
    mockedGet.mockResolvedValue({ content: "# 航模入门\n\n正文内容" });

    render(<KnowledgeReaderPage />);

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(`/api/knowledge/content?path=${encodeURIComponent(DOC)}`));
    expect(await screen.findByText("航模入门")).toBeInTheDocument();
    // 面包屑能看出自己在哪
    expect(screen.getAllByText("资料").length).toBeGreaterThan(0);
    expect(screen.getByText("航模入门.md")).toBeInTheDocument();
  });

  it("队员看不到「编辑」入口（点进去也会被踢回首页）", async () => {
    mockedGet.mockResolvedValue({ content: "# 标题" });

    render(<KnowledgeReaderPage />);

    await screen.findByText("标题");
    expect(screen.queryByRole("link", { name: /编辑/ })).not.toBeInTheDocument();
  });

  it("部长能看到「编辑」并指向管理端编辑器", async () => {
    mockedUser.mockReturnValue({ user: { id: 3, username: "部长", role: "部长", department: "飞训部", departmentId: 1 }, loading: false, refresh: vi.fn() });
    mockedGet.mockResolvedValue({ content: "# 标题" });

    render(<KnowledgeReaderPage />);

    await screen.findByText("标题");
    expect(screen.getByRole("link", { name: /编辑/ }))
      .toHaveAttribute("href", `/admin/knowledge?path=${encodeURIComponent(DOC)}`);
  });

  it("没有权限时说明原因，而不是白屏", async () => {
    mockedGet.mockRejectedValue(new Error("HTTP 403"));

    render(<KnowledgeReaderPage />);

    expect(await screen.findByText("打不开这份文档")).toBeInTheDocument();
    expect(screen.getByText(/没有这份文档的权限/)).toBeInTheDocument();
  });

  it("学习库文档给出回学习库的入口", async () => {
    const lesson = "飞训部/学习库/01-入门筑基/01-认识航模.md";
    window.history.pushState({}, "", `/knowledge?path=${encodeURIComponent(lesson)}`);
    mockedGet.mockResolvedValue({ content: "# 认识航模" });

    render(<KnowledgeReaderPage />);

    await screen.findByText("认识航模");
    expect(screen.getByRole("link", { name: /学习库/ })).toHaveAttribute("href", "/study");
  });
});

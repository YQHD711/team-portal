import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KnowledgeAdminPage from "@/app/(protected)/admin/knowledge/page";
import { api } from "@/lib/api";
import { isStaff } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ isStaff: vi.fn(() => true), getToken: vi.fn(() => "t") }));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "admin", username: "u" }, loading: false, refresh: vi.fn() }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedIsStaff = vi.mocked(isStaff);

const LESSON = "公共/学习库/01-入门筑基/01-认识航模.md";
const OVERVIEW = "公共/学习库/_学习路径.md";

/** 与真实扫描一致：目录在前，文件在后。 */
const tree = [
  {
    name: "公共知识库", type: "folder", path: "公共",
    children: [
      {
        name: "学习库", type: "folder", path: "公共/学习库",
        children: [
          {
            name: "01-入门筑基", type: "folder", path: "公共/学习库/01-入门筑基",
            children: [{ name: "01-认识航模", type: "file", path: LESSON, extra: { ext: ".md" } }],
          },
          { name: "_学习路径", type: "file", path: OVERVIEW, extra: { ext: ".md" } },
        ],
      },
      { name: "空目录", type: "folder", path: "公共/空目录", children: [] },
    ],
  },
];

function mockApi() {
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/knowledge/tree") return tree;
    if (endpoint.startsWith("/api/knowledge/content")) {
      // 生产环境里对**目录**调 content 接口是失败的（就是个目录，没有内容）。
      // 这里如实模拟，否则测不出"目录深链接被静默吞掉"这个缺陷。
      const p = decodeURIComponent(endpoint.split("path=")[1] ?? "");
      if (!p.includes(".")) throw new Error("不是可读文档");
      return { content: "# 文档内容" };
    }
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsStaff.mockReturnValue(true);
  mockApi();
  window.history.pushState({}, "", "/admin/knowledge");
});

afterEach(() => {
  window.history.pushState({}, "", "/admin/knowledge");
});

describe("知识库管理页 · 目录树折叠", () => {
  it("默认全部收起：能看到顶层目录，但看不到里面的文档", async () => {
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText("学习库/")).toBeInTheDocument();
    expect(screen.queryByText("_学习路径")).not.toBeInTheDocument();
  });

  it("点箭头展开后显示子项，再点收起", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("学习库/");

    fireEvent.click(screen.getByRole("button", { name: "展开 学习库" }));

    expect(screen.getByText("_学习路径")).toBeInTheDocument();
    expect(screen.getByText("01-入门筑基/")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠 学习库" }));
    expect(screen.queryByText("_学习路径")).not.toBeInTheDocument();
  });

  it("「全部展开」一次展开所有层级", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("学习库/");

    fireEvent.click(screen.getByRole("button", { name: "全部展开" }));

    expect(screen.getByText("_学习路径")).toBeInTheDocument();
    expect(screen.getByText("01-认识航模")).toBeInTheDocument();
  });

  it("「全部收起」把展开的都收回去", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("学习库/");
    fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getByText("01-认识航模")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部收起" }));

    expect(screen.queryByText("01-认识航模")).not.toBeInTheDocument();
    expect(screen.getByText("学习库/")).toBeInTheDocument();
  });
});

describe("知识库管理页 · ?path= 深链接", () => {
  it("?path= 指向**目录**时自动打开里面的第一个文档（回归：以前静默空白）", async () => {
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent("公共/学习库")}`);
    render(<KnowledgeAdminPage />);

    // 目录被自动展开 + 打开其入口文档
    expect(await screen.findByText("_学习路径")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(`/api/knowledge/content?path=${encodeURIComponent(OVERVIEW)}`));
    expect(await screen.findByDisplayValue("# 文档内容")).toBeInTheDocument();
    // 不能是"静默空白"
    expect(screen.queryByText("选择文件开始编辑")).not.toBeInTheDocument();
  });

  it("?path= 指向文件时直接打开", async () => {
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent(LESSON)}`);
    render(<KnowledgeAdminPage />);

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(`/api/knowledge/content?path=${encodeURIComponent(LESSON)}`));
    expect(await screen.findByDisplayValue("# 文档内容")).toBeInTheDocument();
  });

  it("目录里没有文档时给出提示，而不是静默空白", async () => {
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent("公共/空目录")}`);
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText(/下还没有文档/)).toBeInTheDocument();
  });

  it("?path= 打开文件时自动展开它的父链（否则左侧看不到它在哪）", async () => {
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent(LESSON)}`);
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText("01-认识航模")).toBeInTheDocument();
    expect(screen.getByText("01-入门筑基/")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KnowledgeAdminPage from "@/app/(protected)/admin/knowledge/page";
import { api } from "@/lib/api";

/**
 * 删除入口的可见性与安全性。
 *
 * 背景（用户报「知识库的删除键太不明显了」）：
 * - 树里的删除按钮原来是 `opacity-0 group-hover:opacity-100`：不 hover 根本看不到，
 *   触屏与键盘用户更是找不到；图标 12px、命中区 16×16，名字只写在 title 里（读屏只念 "button"）。
 * - 编辑区头部的删除是个**没有名字**的裸图标，混在一排图标里。
 * 现在：树里常态可见（危险色但 muted）、有 aria-label、命中区更大；头部是带文字的「删除」按钮；
 * 两者都仍然先弹确认对话框。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ isStaff: vi.fn(() => true), getToken: vi.fn(() => "t") }));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "admin", username: "u" }, loading: false, refresh: vi.fn() }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedDelete = vi.mocked(api.delete as (endpoint: string) => Promise<unknown>);

const DOC = "公共/学习库/01-入门筑基/01-认识航模.md";
const tree = [{
  name: "公共知识库", type: "folder", path: "公共", children: [
    { name: "学习库", type: "folder", path: "公共/学习库", children: [
      { name: "01-认识航模", type: "file", path: DOC, extra: { ext: ".md" } },
    ] },
  ],
}];

let confirmSpy: MockInstance<(message?: string) => boolean>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedDelete.mockResolvedValue({});
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/knowledge/tree") return tree;
    if (endpoint.startsWith("/api/knowledge/content")) return { content: "# 认识航模\n\n正文" };
    return {};
  });
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  window.history.pushState({}, "", "/admin/knowledge");
});

afterEach(() => { confirmSpy.mockRestore(); });

/** 打开页面并展开目录树（默认是折叠的，文件节点还没渲染） */
async function openTree() {
  render(<KnowledgeAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: "全部展开" }));
  return screen.getByLabelText(`删除 01-认识航模`);
}

describe("知识库删除入口", () => {
  it("树里：不用 hover 就能看到（不再是 opacity-0），有 aria-label 与更大的命中区", async () => {
    const del = await openTree();

    expect(del).toBeInTheDocument();
    expect(del).toHaveAttribute("aria-label", "删除 01-认识航模");
    expect(del).toHaveAttribute("title");                       // tooltip 文案
    // 回归钉子：以前是 opacity-0 group-hover:opacity-100 —— 不 hover 就看不见
    expect(del.className).not.toContain("opacity-0");
    // 危险操作要够显眼（危险色 + 内边距撑出点击区），但不是实心红（避免误触）
    expect(del.className).toContain("text-danger/70");
    expect(del.className).toContain("p-1");
  });

  it("文件夹行同样有带名字的删除入口", async () => {
    await openTree();

    expect(screen.getByLabelText("删除文件夹 学习库")).toBeInTheDocument();
    expect(screen.getByLabelText("重命名文件夹 学习库")).toBeInTheDocument();
  });

  it("点删除仍然先弹确认：取消就什么都不删", async () => {
    const del = await openTree();

    fireEvent.click(del);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(DOC));
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("确认后才真的调删除接口", async () => {
    confirmSpy.mockReturnValue(true);
    const del = await openTree();

    fireEvent.click(del);

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(
      `/api/admin/knowledge/delete?path=${encodeURIComponent(DOC)}`));
  });

  it("编辑区头部：删除是带文字的按钮（不再是没名字的裸图标），同样先弹确认", async () => {
    await openTree();
    fireEvent.click(screen.getByText("01-认识航模"));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(
      `/api/knowledge/content?path=${encodeURIComponent(DOC)}`));

    const headerDel = await screen.findByLabelText(`删除文档 ${DOC}`);
    expect(headerDel).toHaveTextContent("删除");   // 有文字标签，不再只靠一个红叉图标
    expect(headerDel).toHaveAttribute("title");

    confirmSpy.mockReturnValue(false);
    fireEvent.click(headerDel);
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});

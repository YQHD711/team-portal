import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StudyPage from "@/app/(protected)/study/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

/**
 * 学习库的块级就地编辑：正文来自知识库，写回**同一个** .md，
 * 走已有的 `POST /api/admin/knowledge/write`（StaffOnly），权限仍是页面里的 canEdit。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (e: string, b: unknown) => Promise<unknown>);
const mockedUser = vi.mocked(useCurrentUser);

const LESSON = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const DOC = [
  "# 认识航模",
  "",
  "第一段正文：机翼产生升力。",
  "",
  "```mermaid",
  "graph TD;",
  "  A[起飞] --> B[降落];",
  "```",
  "",
  "| 参数 | 值 |",
  "| --- | --- |",
  "| 翼展 | 1200mm |",
].join("\n");

function scopeOf(canEdit: boolean) {
  return {
    scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit,
    overviewPath: null, completedCount: 0, lessonCount: 1,
    stages: [{
      title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit, descriptionPath: null,
      lessons: [{ title: "认识航模", path: LESSON, canEdit, completed: false }],
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", `/study?lesson=${encodeURIComponent(LESSON)}`);
  mockedUser.mockReturnValue({ user: { id: 3, username: "部长", role: "部长", department: "飞训部", departmentId: 1 }, loading: false, refresh: vi.fn() });
  mockedPost.mockResolvedValue({});
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/study/library") return { scopes: [scopeOf(true)] };
    if (endpoint.startsWith("/api/knowledge/content")) return { content: DOC };
    return {};
  });
});

describe("学习库：块级就地编辑", () => {
  it("改一段 → 写回同一个知识库文件，其余内容（mermaid/表格/标题）逐字符不变", async () => {
    render(<StudyPage />);
    await screen.findAllByTestId("md-block", {}, { timeout: 5000 });

    const block = screen.getAllByTestId("md-block").find(b => b.textContent?.includes("机翼产生升力"))!;
    fireEvent.click(within(block).getByTestId("md-block-edit"));
    fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: "第一段正文：升力来自机翼上下压力差。" } });
    fireEvent.click(screen.getByTestId("md-block-save"));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPost.mock.calls[0] as [string, { path: string; content: string }];
    expect(url).toBe("/api/admin/knowledge/write");
    expect(body.path).toBe(LESSON);
    const head = DOC.indexOf("第一段正文");
    expect(body.content.slice(0, head)).toBe(DOC.slice(0, head));
    expect(body.content.slice(body.content.indexOf("```mermaid"))).toBe(DOC.slice(DOC.indexOf("```mermaid")));
    expect(body.content).toContain("升力来自机翼上下压力差");
    // 保存后立即显示新内容
    expect(await screen.findByText(/升力来自机翼上下压力差/)).toBeInTheDocument();
  });

  it("canEdit=false：只读，没有任何编辑入口（不放宽权限）", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/study/library") return { scopes: [scopeOf(false)] };
      if (endpoint.startsWith("/api/knowledge/content")) return { content: DOC };
      return {};
    });
    render(<StudyPage />);
    await screen.findByText(/机翼产生升力/, {}, { timeout: 5000 });

    expect(screen.queryByTestId("md-block-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("md-block-editor")).not.toBeInTheDocument();
  });
});

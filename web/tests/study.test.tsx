import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StudyPage from "@/app/(protected)/study/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));
// MarkdownRenderer 会按需动态加载 mermaid/语法高亮，单测里换成纯文本占位
vi.mock("@/components/knowledge/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const LESSON1 = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const LESSON2 = "飞训部/学习库/01-入门筑基/02-安全规范.md";
const contentUrl = (p: string) => `/api/knowledge/content?path=${encodeURIComponent(p)}`;

const memberUser = { id: 2, username: "王睿翔", role: "member", department: null, departmentId: null };
const leaderUser = { id: 3, username: "部长", role: "部长", department: "飞训部", departmentId: 1 };

function scope(canEdit: boolean, completed: string[] = []) {
  const done = new Set(completed);
  const lessons = [
    { title: "认识航模", path: LESSON1, canEdit, completed: done.has(LESSON1) },
    { title: "安全规范", path: LESSON2, canEdit, completed: done.has(LESSON2) },
  ];
  const doneCount = lessons.filter(l => l.completed).length;
  return {
    scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit,
    overviewPath: "飞训部/学习库/_学习路径.md",
    overview: "从零开始，学完能自己飞。",
    duration: "2-3 周", goal: "能独立完成一次起降",
    completedCount: doneCount, lessonCount: lessons.length,
    stages: [
      {
        title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit,
        descriptionPath: "飞训部/学习库/01-入门筑基/_阶段说明.md",
        description: "本阶段把术语和原理过一遍。", duration: "1 周", goal: "知道机翼为什么产生升力",
        completedCount: doneCount, lessons,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 没实现 scrollIntoView（切换课时时会把正文滚回开头）
  Element.prototype.scrollIntoView = vi.fn();
  mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
  mockedPost.mockResolvedValue({});
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/study/library") return { scopes: [scope(false)] };
    if (endpoint.startsWith("/api/knowledge/content")) return { content: "## 正文\n\n内容" };
    if (endpoint.startsWith("/api/study/stats")) {
      return { scope: "飞训部", memberCount: 8, lessons: [{ title: "认识航模", path: LESSON1, completedCount: 3 }] };
    }
    return {};
  });
});

describe("学习库页", () => {
  it("默认展示学习路径：阶段卡片带时长/目标/课时清单", async () => {
    render(<StudyPage />);

    expect(await screen.findByRole("heading", { name: "学习库" })).toBeInTheDocument();
    expect(screen.getByText("入门筑基")).toBeInTheDocument();
    expect(screen.getByText("1 周")).toBeInTheDocument();
    expect(screen.getByText("2-3 周")).toBeInTheDocument();
    expect(screen.getByText("知道机翼为什么产生升力")).toBeInTheDocument();
    expect(screen.getByText(/能独立完成一次起降/)).toBeInTheDocument();
    expect(screen.getByText("0/2 课时")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringContaining("/api/knowledge/content"));
  });

  it("阶段说明真的被渲染出来（此前只有路径、没有正文）", async () => {
    render(<StudyPage />);

    await screen.findByText("入门筑基");
    expect(screen.getAllByTestId("md").map(n => n.textContent).join("|")).toContain("本阶段把术语和原理过一遍");
  });

  it("勾选课时调用进度接口，并就地更新进度（不等刷新）", async () => {
    render(<StudyPage />);
    await screen.findByText("入门筑基");

    fireEvent.click(screen.getByRole("button", { name: "标记完成 认识航模" }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/study/progress", { path: LESSON1, completed: true }));
    expect(await screen.findByText("1/2 课时")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消完成 认识航模" })).toBeInTheDocument();
  });

  it("已完成的课时可以取消勾选", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/study/library") return { scopes: [scope(false, [LESSON1])] };
      return { content: "x" };
    });
    render(<StudyPage />);
    await screen.findByText("1/2 课时");

    fireEvent.click(screen.getByRole("button", { name: "取消完成 认识航模" }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/study/progress", { path: LESSON1, completed: false }));
    expect(await screen.findByText("0/2 课时")).toBeInTheDocument();
  });

  it("点击课时进入阅读页：调正文接口并显示进度与下一课", async () => {
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^认识航模$/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON1)));
    expect(await screen.findByText(/第 1 \/ 2 课/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一课/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /上一课/ })).not.toBeInTheDocument();
  });

  it("下一课按学习路径顺序前进", async () => {
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^认识航模$/ }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON1)));

    fireEvent.click(screen.getByRole("button", { name: /下一课/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON2)));
    expect(await screen.findByText(/第 2 \/ 2 课/)).toBeInTheDocument();
  });

  it("阅读页也能标记完成", async () => {
    render(<StudyPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^认识航模$/ }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON1)));

    fireEvent.click(screen.getByRole("button", { name: /标记完成/ }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/study/progress", { path: LESSON1, completed: true }));
    expect(await screen.findByRole("button", { name: /已完成/ })).toBeInTheDocument();
  });

  it("队员看不到「完成情况」入口（那是部长/管理员的）", async () => {
    render(<StudyPage />);

    await screen.findByText("入门筑基");
    expect(screen.queryByRole("button", { name: /完成情况/ })).not.toBeInTheDocument();
  });

  it("部长可打开本部门完成情况", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: leaderUser, loading: false, refresh: vi.fn() });
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /完成情况/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/study/stats?scope=" + encodeURIComponent("飞训部")));
    expect(await screen.findByText(/3 \/ 8 人/)).toBeInTheDocument();
  });

  it("没有编辑权限时不给编辑入口", async () => {
    render(<StudyPage />);

    await screen.findByText("入门筑基");
    expect(screen.queryByRole("link", { name: /编辑/ })).not.toBeInTheDocument();
  });

  it("有编辑权限时跳到知识库编辑器（不重写编辑器）", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/study/library") return { scopes: [scope(true)] };
      return { content: "x" };
    });
    render(<StudyPage />);

    const edit = await screen.findByRole("link", { name: /编辑本库/ });

    expect(edit).toHaveAttribute("href", `/admin/knowledge?path=${encodeURIComponent("飞训部/学习库")}`);
  });

  it("还没有学习库时给出目录约定说明", async () => {
    mockedGet.mockImplementation(async () => ({ scopes: [] }));
    render(<StudyPage />);

    expect(await screen.findByText(/还没有学习库内容/)).toBeInTheDocument();
    expect(screen.getByText(/一级子目录 = 阶段/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去知识库创建/ })).toBeInTheDocument();
  });
});

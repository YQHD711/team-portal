import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StudyPage from "@/app/(protected)/study/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

/**
 * 搜索学习库结果的落点。
 *
 * 后端对「说明类」文档（`_学习路径.md` / `_阶段说明.md`）给的跳转地址是光秃秃的 `/study`，
 * 所以 GlobalSearch 追加 q 之后就是 `/study?q=<词>`（用户报的那条）。总览页必须据此把命中
 * 高亮出来并滚过去，否则用户看到的就是"跳回学习库主页、什么都没发生"。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const TERM = "cuadc";
const LESSON = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const B_LESSON = "电子部/学习库/01-焊接基础/01-认识烙铁.md";
const contentUrl = (p: string) => `/api/knowledge/content?path=${encodeURIComponent(p)}`;

function scopeOf(scope: string, lesson: string, lessonTitle: string) {
  return {
    scope, label: `${scope}学习库`, libraryPath: `${scope}/学习库`, canEdit: false,
    overviewPath: `${scope}/学习库/_学习路径.md`, overview: `总览里提到 ${TERM} 的用法。`,
    completedCount: 0, lessonCount: 1,
    stages: [{
      title: "入门筑基", path: `${scope}/学习库/01-入门筑基`, canEdit: false,
      descriptionPath: `${scope}/学习库/01-入门筑基/_阶段说明.md`,
      description: `阶段说明里也提到 ${TERM}。`,
      lessons: [{ title: lessonTitle, path: lesson, canEdit: false, completed: false }],
    }],
  };
}

function withUrl(search: string) {
  window.history.replaceState({}, "", `/study${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mockedUseCurrentUser.mockReturnValue({ user: { id: 2, username: "u", role: "member", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/study/library") return { scopes: [scopeOf("飞训部", LESSON, "认识航模"), scopeOf("电子部", B_LESSON, "认识烙铁")] };
    if (endpoint.startsWith("/api/knowledge/content")) return { content: `## 正文\n\n${TERM} 在这里。` };
    return {};
  });
});

afterEach(() => { withUrl(""); });

describe("学习库：搜索落点", () => {
  it("?q=（说明类结果的后端落点）：总览正文里命中处高亮，不再「点什么都没发生」", async () => {
    withUrl(`?q=${TERM}`);
    render(<StudyPage />);

    expect(await screen.findByRole("heading", { name: "学习库" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("md-highlight").length).toBeGreaterThan(0));
    // 停在总览：说明类文档的正文就在本页，不该去请求课时正文
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringContaining("/api/knowledge/content"));
  });

  it("命中在默认折叠的「阶段说明」里时自动展开，命中可见", async () => {
    withUrl(`?q=${TERM}`);
    const { container } = render(<StudyPage />);
    await screen.findByRole("heading", { name: "学习库" });

    const details = await waitFor(() => {
      const d = container.querySelector("details");
      expect(d).not.toBeNull();
      return d!;
    });
    await waitFor(() => expect(details.hasAttribute("open")).toBe(true));
    expect(details.querySelector('[data-testid="md-highlight"]')).not.toBeNull();
  });

  it("?lesson=&q=：lesson 参数照样生效（目标课时打开 + 高亮）", async () => {
    withUrl(`?lesson=${encodeURIComponent(LESSON)}&q=${TERM}`);
    render(<StudyPage />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON)));
    await waitFor(() => expect(screen.getAllByTestId("md-highlight").length).toBeGreaterThan(0));
  });

  it("跨 scope 的课时也能定位（搜到别的部门的课不会退回总览）", async () => {
    withUrl(`?lesson=${encodeURIComponent(B_LESSON)}&q=${TERM}`);
    render(<StudyPage />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(B_LESSON)));
    // 落在课时阅读视图（不是总览页）
    expect(await screen.findByText(/第 1 \/ 1 课/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("md-highlight").length).toBeGreaterThan(0));
  });

  it("说明类命中在别的部门的库里 → 自动切到那个库（不是停在本部门总览）", async () => {
    // 只有电子部的正文含这个词
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/study/library") {
        const a = scopeOf("飞训部", LESSON, "认识航模");
        const b = scopeOf("电子部", B_LESSON, "认识烙铁");
        return { scopes: [{ ...a, overview: "飞训部总览", stages: [{ ...a.stages[0], description: "飞训部阶段说明" }] }, b] };
      }
      return { content: "" };
    });
    withUrl(`?q=${TERM}`);
    render(<StudyPage />);

    await waitFor(() => expect(screen.getAllByTestId("md-highlight").length).toBeGreaterThan(0));
    // 切到了电子部：它的阶段说明是默认折叠的，也被展开显示了命中
    expect(screen.getByText("电子部学习库")).toBeInTheDocument();
    expect(screen.getByText(/阶段说明里也提到/)).toBeInTheDocument();
  });

  it("不带 q：不产生任何高亮（回归）", async () => {
    withUrl("");
    const { container } = render(<StudyPage />);
    await screen.findByRole("heading", { name: "学习库" });

    expect(container.querySelector('[data-testid="md-highlight"]')).toBeNull();
  });
});

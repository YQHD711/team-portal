import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WikiViewerPage from "@/app/(protected)/wiki/[id]/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

/**
 * Wiki 文档的块级就地编辑 + 「重新生成会覆盖人工修改」的处理（方案 c）。
 * 后端契约见 task-11：PUT /api/wiki/tasks/{id}/doc（StaffOnly）、GET /edits、POST /update?force=true。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "t1" }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/wiki/WikiDocRecovery", () => ({ WikiDocRecovery: () => null }));
vi.mock("@/components/wiki/WikiWorkspaceBanner", () => ({ WikiWorkspaceBanner: () => null }));
vi.mock("@/lib/wikiRetry", () => ({ retryMissingDocuments: vi.fn() }));

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (e: string, b: unknown) => Promise<unknown>);
const mockedPut = vi.mocked(api.put as (e: string, b: unknown) => Promise<unknown>);
const mockedUser = vi.mocked(useCurrentUser);

const DOC = [
  "# 快速开始",
  "",
  "第一段说明文字。",
  "",
  "```bash",
  "npm install",
  "```",
  "",
  "| 项 | 说明 |",
  "| --- | --- |",
  "| A | 甲 |",
].join("\n");

const task = { id: "t1", projectName: "ardupilot", status: "completed", targetFolder: "公共", visibility: "public", type: "git" };
const catalog = [{ path: "getting-started/intro", title: "介绍" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedUser.mockReturnValue({ user: { id: 1, username: "admin", role: "admin", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
  mockedPost.mockResolvedValue({});
  mockedPut.mockResolvedValue({ ok: true });
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint.startsWith("/api/wiki/tasks/t1/doc")) return { content: DOC };
    if (endpoint === "/api/wiki/tasks/t1/catalog") return catalog;
    if (endpoint === "/api/wiki/tasks/t1") return task;
    if (endpoint === "/api/wiki/tasks/t1/edits") return { count: 2, paths: ["a", "b"] };
    return {};
  });
});

afterEach(() => vi.restoreAllMocks());

const editParagraph = async (text: string) => {
  const block = (await screen.findAllByTestId("md-block")).find(b => b.textContent?.includes("第一段说明文字"));
  if (!block) throw new Error("没找到段落块");
  fireEvent.click(within(block).getByTestId("md-block-edit"));
  fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("md-block-save"));
};

describe("Wiki：块级就地编辑", () => {
  it("staff 能看到编辑入口与「AI 生成」提示，保存走 PUT /doc 且其余内容逐字不变", async () => {
    render(<WikiViewerPage />);
    await screen.findAllByTestId("md-block");

    expect(screen.getByTestId("wiki-manual-edit-notice")).toHaveTextContent(/AI 生成的文档/);

    await editParagraph("第一段说明文字改过了。");

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPut.mock.calls[0] as [string, { path: string; lang: string; content: string }];
    expect(url).toBe("/api/wiki/tasks/t1/doc");
    expect(body.path).toBe("getting-started/intro");
    expect(body.lang).toBe("zh");
    // 只替换了段落：代码块/表格/标题逐字符不变
    expect(body.content.slice(0, DOC.indexOf("第一段说明文字"))).toBe(DOC.slice(0, DOC.indexOf("第一段说明文字")));
    expect(body.content.slice(body.content.indexOf("```bash"))).toBe(DOC.slice(DOC.indexOf("```bash")));
    expect(body.content).toContain("第一段说明文字改过了。");
    // 保存后立即显示新内容
    expect(await screen.findByText("第一段说明文字改过了。")).toBeInTheDocument();
  });

  it("普通成员看不到任何编辑入口与提示（权限沿用现有规则，不放宽）", async () => {
    mockedUser.mockReturnValue({ user: { id: 2, username: "member", role: "member", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
    render(<WikiViewerPage />);

    expect(await screen.findByText("第一段说明文字。")).toBeInTheDocument();
    expect(screen.queryByTestId("md-block-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wiki-manual-edit-notice")).not.toBeInTheDocument();
  });
});

describe("Wiki：重新生成前的覆盖确认（方案 c）", () => {
  it("有 2 处人工修改：先弹确认；取消则不发 update", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<WikiViewerPage />);
    await screen.findByRole("button", { name: /检查修正/ });

    fireEvent.click(screen.getByRole("button", { name: /检查修正/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/wiki/tasks/t1/edits"));
    expect(confirmSpy.mock.calls[0][0]).toContain("2 处文档已被人工修改");
    expect(mockedPost).not.toHaveBeenCalledWith(expect.stringContaining("/update"), expect.anything());
  });

  it("确认后带 force=true 重新生成", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WikiViewerPage />);
    await screen.findByRole("button", { name: /检查修正/ });

    fireEvent.click(screen.getByRole("button", { name: /检查修正/ }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/update?force=true", {}));
  });

  it("没有人工修改时行为不变（不带 force）", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/wiki/tasks/t1/doc")) return { content: DOC };
      if (endpoint === "/api/wiki/tasks/t1/catalog") return catalog;
      if (endpoint === "/api/wiki/tasks/t1") return task;
      if (endpoint === "/api/wiki/tasks/t1/edits") return { count: 0, paths: [] };
      return {};
    });
    render(<WikiViewerPage />);
    await screen.findByRole("button", { name: /检查修正/ });

    fireEvent.click(screen.getByRole("button", { name: /检查修正/ }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/update", {}));
  });
});

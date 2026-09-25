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
const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);
const mockedIsStaff = vi.mocked(isStaff);

const LESSON = "公共/学习库/01-入门筑基/01-认识航模.md";
const OVERVIEW = "公共/学习库/_学习路径.md";
const DEPT_OVERVIEW = "飞训部/学习库/_飞训路径.md";

/**
 * 真实结构：/api/knowledge/tree 返回的是**根节点数组** ——
 * `[公共知识库, 飞训部, ...]`，部门是与公共**平级**的根节点。
 * 与真实扫描一致：目录在前，文件在后。
 */
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
  {
    name: "飞训部", type: "folder", path: "飞训部",
    children: [
      {
        name: "学习库", type: "folder", path: "飞训部/学习库",
        children: [{ name: "_飞训路径", type: "file", path: DEPT_OVERVIEW, extra: { ext: ".md" } }],
      },
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
  mockedPost.mockResolvedValue({});
  mockApi();
  window.history.pushState({}, "", "/admin/knowledge");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/admin/knowledge");
});

describe("知识库管理页 · 错误可见性", () => {
  it("保存失败时显示后端的真实原因（以前一律只说「保存失败」，没法查）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    mockedPost.mockRejectedValue(new Error("没有写入权限：Access to the path '/data/knowledge/…/a.md.tmp' is denied."));
    render(<KnowledgeAdminPage />);

    // 打开一个文件 → 改动 → 保存
    fireEvent.click(await screen.findByRole("button", { name: "展开 公共知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 学习库" }));
    fireEvent.click(screen.getByRole("button", { name: "_学习路径" }));
    const box = await screen.findByDisplayValue("# 文档内容");
    fireEvent.change(box, { target: { value: "# 改过了" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存/ }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy.mock.calls[0][0]).toContain("没有写入权限");
    expect(alertSpy.mock.calls[0][0]).toContain("is denied");
  });

  it("保存成功则不弹错误", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    render(<KnowledgeAdminPage />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 公共知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 学习库" }));
    fireEvent.click(screen.getByRole("button", { name: "_学习路径" }));
    const box = await screen.findByDisplayValue("# 文档内容");
    fireEvent.change(box, { target: { value: "# 改过了" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存/ }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/admin/knowledge/write",
      expect.objectContaining({ path: OVERVIEW })));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("知识库管理页 · 目录树折叠", () => {
  it("默认全部收起：只看到根作用域", async () => {
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText("公共知识库/")).toBeInTheDocument();
    expect(screen.queryByText("学习库/")).not.toBeInTheDocument();
  });

  it("逐级展开后显示子项，再点收起", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("公共知识库/");

    fireEvent.click(screen.getByRole("button", { name: "展开 公共知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 学习库" }));

    expect(screen.getByText("_学习路径")).toBeInTheDocument();
    expect(screen.getByText("01-入门筑基/")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠 学习库" }));
    expect(screen.queryByText("_学习路径")).not.toBeInTheDocument();
  });

  it("「全部展开」一次展开所有层级", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("公共知识库/");

    fireEvent.click(screen.getByRole("button", { name: "全部展开" }));

    expect(screen.getByText("_学习路径")).toBeInTheDocument();
    expect(screen.getByText("01-认识航模")).toBeInTheDocument();
    expect(screen.getByText("_飞训路径")).toBeInTheDocument();   // 部门那边也展开
  });

  it("「全部收起」把展开的都收回去", async () => {
    render(<KnowledgeAdminPage />);
    await screen.findByText("公共知识库/");
    fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getByText("01-认识航模")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部收起" }));

    expect(screen.queryByText("01-认识航模")).not.toBeInTheDocument();
    expect(screen.getByText("公共知识库/")).toBeInTheDocument();
  });

  it("部门根目录也要出现在树里（回归：此前只渲染公共那一支，部门整个看不到）", async () => {
    render(<KnowledgeAdminPage />);

    // /api/knowledge/tree 返回的是根节点数组，部门与公共**平级**
    expect(await screen.findByText("公共知识库/")).toBeInTheDocument();
    expect(screen.getByText("飞训部/")).toBeInTheDocument();
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

  it("?path= 指向**部门**下的目录同样能展开并打开（部门根没渲染时就完全看不到）", async () => {
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent("飞训部/学习库")}`);
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText("_飞训路径")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(`/api/knowledge/content?path=${encodeURIComponent(DEPT_OVERVIEW)}`));
  });
});

describe("知识库管理页 · 插入图片", () => {
  it("上传到当前文档所在目录，并把 `![文件名](文件名)` 插到正文里", async () => {
    mockedPost.mockResolvedValue({ path: `${LESSON.replace(/\/[^/]+$/, "")}/示意图.png` });
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent(LESSON)}`);
    render(<KnowledgeAdminPage />);

    const box = await screen.findByDisplayValue<HTMLTextAreaElement>("# 文档内容");
    // 光标放到正文末尾，插入内容应落在那里
    box.setSelectionRange(box.value.length, box.value.length);

    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]');
    expect(input, "编辑工具栏应有隐藏的图片选择框").not.toBeNull();
    const file = new File([new Uint8Array([1, 2, 3])], "示意图.png", { type: "image/png" });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    // 目录取文档所在目录 —— 图片与文档同目录，整体挪目录也不会失效
    expect(mockedPost.mock.calls[0][0]).toBe(
      `/api/admin/knowledge/asset?dir=${encodeURIComponent("公共/学习库/01-入门筑基")}`);
    expect((mockedPost.mock.calls[0][1] as FormData).get("file")).toBe(file);

    await waitFor(() => expect(box.value).toContain("![示意图.png](示意图.png)"));
  });

  it("上传失败时把后端原因显示出来（不是静默什么都不发生）", async () => {
    mockedPost.mockRejectedValue(new Error("不支持的图片格式 .bmp"));
    window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent(LESSON)}`);
    render(<KnowledgeAdminPage />);

    const box = await screen.findByDisplayValue("# 文档内容");
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]');
    fireEvent.change(input!, { target: { files: [new File([new Uint8Array([1])], "a.bmp", { type: "image/bmp" })] } });

    expect(await screen.findByText(/不支持的图片格式/)).toBeInTheDocument();
    expect(box).toHaveValue("# 文档内容");   // 失败不该改动正文
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WikiImportPage from "@/app/(protected)/wiki/import/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "admin", name: "admin" }, loading: false }),
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown, timeoutMs?: number) => Promise<unknown>);

function showTab(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function submit() {
  const form = screen.getByRole("button", { name: /提交任务/ }).closest("form");
  fireEvent.submit(form!);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url === "/api/wiki/tasks") return Promise.resolve([]);
    if (url === "/api/wiki/settings") return Promise.resolve({ availableModels: [], contentModel: "" });
    return Promise.resolve({});
  });
  mockPost.mockResolvedValue({});
});

describe("Wiki 导入：仅克隆", () => {
  it("勾选「仅克隆」时提交 cloneOnly=true，并给克隆留出更长的超时", async () => {
    render(<WikiImportPage />);
    fireEvent.change(screen.getByPlaceholderText("例如: my-awesome-project"), { target: { value: "proj" } });
    fireEvent.change(screen.getByPlaceholderText("https://github.com/user/repo.git"), { target: { value: "https://github.com/a/b.git" } });
    fireEvent.click(screen.getByLabelText("仅克隆（只下载源码，不生成文档）"));

    submit();

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [url, body, timeout] = mockPost.mock.calls[0];
    expect(url).toBe("/api/wiki/submit-git");
    expect(body).toMatchObject({ cloneOnly: true, url: "https://github.com/a/b.git", projectName: "proj" });
    expect(timeout).toBe(300_000); // 大仓库 clone 会超过默认 30 秒
  });

  it("不勾选时 cloneOnly=false，且不额外延长超时", async () => {
    render(<WikiImportPage />);
    fireEvent.change(screen.getByPlaceholderText("例如: my-awesome-project"), { target: { value: "proj" } });
    fireEvent.change(screen.getByPlaceholderText("https://github.com/user/repo.git"), { target: { value: "https://github.com/a/b.git" } });

    submit();

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [, body, timeout] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ cloneOnly: false });
    expect(timeout).toBeUndefined();
  });

  it("ZIP 上传勾选仅克隆时把 cloneOnly=true 拼进查询串", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<WikiImportPage />);
    fireEvent.change(screen.getByPlaceholderText("例如: my-awesome-project"), { target: { value: "proj" } });
    showTab(/ZIP 上传/);
    const file = new File(["zip"], "src.zip", { type: "application/zip" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByLabelText("仅克隆（只下载源码，不生成文档）"));

    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("cloneOnly=true");
    vi.unstubAllGlobals();
  });
});

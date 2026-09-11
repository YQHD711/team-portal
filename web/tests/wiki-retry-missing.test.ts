import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryMissingDocuments } from "@/lib/wikiRetry";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown) => Promise<unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("补齐缺失文档（成本安全）", () => {
  it("没有缺失时：不发请求、不弹确认", async () => {
    mockGet.mockResolvedValue({ total: 12, missing: [], missingCount: 0 });

    const msg = await retryMissingDocuments("t1", "wiki1");

    expect(msg).toContain("都在");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();     // 一次 AI 调用都不该发生
  });

  it("有缺失时：确认框写清楚只补几篇、不需要重下源码", async () => {
    mockGet.mockResolvedValue({ total: 12, missing: ["a/b", "c/d"], missingCount: 2 });
    mockPost.mockResolvedValue({ message: "已补齐 2 篇文档" });

    const msg = await retryMissingDocuments("t1", "wiki1");

    expect(msg).toBe("已补齐 2 篇文档");
    const text = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(text).toContain("2/12");
    expect(text).toContain("· a/b");
    expect(text).toContain("不需要重新下载源码");
    expect(mockPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/retry-missing", {});
  });

  it("用户取消：不发起补齐请求", async () => {
    mockGet.mockResolvedValue({ total: 5, missing: ["a"], missingCount: 1 });
    vi.mocked(window.confirm).mockReturnValue(false);

    const msg = await retryMissingDocuments("t1", "wiki1");

    expect(msg).toBe("");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("缺失很多时只列前 5 条，其余折叠成「另有 N 篇」", async () => {
    mockGet.mockResolvedValue({
      total: 20, missing: ["a", "b", "c", "d", "e", "f", "g"], missingCount: 7,
    });
    mockPost.mockResolvedValue({});

    await retryMissingDocuments("t1", "wiki1");

    const text = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(text).toContain("· e");
    expect(text).not.toContain("· f");
    expect(text).toContain("另有 2 篇");
  });
});

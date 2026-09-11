import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import FlightLogPage from "@/app/(protected)/flightlog/page";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/download", () => ({ saveBlob: vi.fn() }));
// isAdmin 直接读 localStorage token → JWT payload。这里造一个带 role=admin 的合法 JWT
const jwt = (role: string) => {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  // JWT = header.payload.signature → split(".")[1] 即 payload，decodeRole 从中取 role
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
  })}.sig`;
};
const mockApiGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockApiDel = vi.mocked(api.delete as (endpoint: string) => Promise<unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApiGet.mockResolvedValue({
    logs: [{ filename: "a.tlog", size: 1024, modified: 1700000000 }],
  });
  mockApiDel.mockResolvedValue({ success: true });
});

describe("飞行日志页", () => {
  it("admin 看到删除按钮；点击确认后调 DELETE 并刷新", async () => {
    localStorage.setItem("token", jwt("admin"));
    window.confirm = vi.fn(() => true);

    render(<FlightLogPage />);
    const delBtn = await screen.findByRole("button", { name: /删除/ });
    expect(delBtn).toBeInTheDocument();

    fireEvent.click(delBtn);
    await waitFor(() =>
      expect(mockApiDel).toHaveBeenCalledWith("/api/flightlogs/a.tlog")
    );
    // 删除后重新拉列表
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it("取消确认则不调用删除接口", async () => {
    localStorage.setItem("token", jwt("admin"));
    window.confirm = vi.fn(() => false);

    render(<FlightLogPage />);
    const delBtn = await screen.findByRole("button", { name: /删除/ });
    fireEvent.click(delBtn);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockApiDel).not.toHaveBeenCalled();
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });

  it("非 admin 不显示删除按钮", async () => {
    localStorage.setItem("token", jwt("member"));
    render(<FlightLogPage />);

    await screen.findByText("a.tlog");
    expect(screen.queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
  });

  it("下载走带鉴权的 api.download（<a href> 不带 Authorization 头会 401）", async () => {
    localStorage.setItem("token", jwt("member"));
    const blob = new Blob(["log"]);
    vi.mocked(api.download as (endpoint: string, options?: unknown) => Promise<Blob>).mockResolvedValue(blob);

    render(<FlightLogPage />);
    fireEvent.click(await screen.findByRole("button", { name: /下载 a.tlog/ }));

    await waitFor(() =>
      expect(api.download).toHaveBeenCalledWith(
        "/api/flightlogs/a.tlog",
        expect.objectContaining({ timeoutMs: 300000, onProgress: expect.any(Function) })
      )
    );
    expect(saveBlob).toHaveBeenCalledWith(blob, "a.tlog");
  });

  it("默认展示「日志文件」Tab，切到「固件下载」才挂载固件面板", async () => {
    localStorage.setItem("token", jwt("member"));
    mockApiGet.mockImplementation((endpoint: string) =>
      endpoint === "/api/firmware/sources"
        ? Promise.resolve({ sources: [] })
        : Promise.resolve({ logs: [{ filename: "a.tlog", size: 1024, modified: 1700000000 }] })
    );

    render(<FlightLogPage />);
    await screen.findByText("a.tlog");

    // 未切换 Tab 时不应打固件接口
    expect(mockApiGet).not.toHaveBeenCalledWith("/api/firmware/sources");

    fireEvent.click(screen.getByRole("tab", { name: /固件下载/ }));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/api/firmware/sources"));
  });
});
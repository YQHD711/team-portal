import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import OperationLogsTab from "@/components/admin/logs/OperationLogsTab";
import RequestLogsTab from "@/components/admin/logs/RequestLogsTab";
import { api } from "@/lib/api";
import { datedFilename } from "@/lib/download";

/**
 * 两处日志导出：同样必须走 api.download（AdminOnly 接口，window.open 的新标签页发不出 token → 401）。
 * 文件名用客户端默认名（api.download 只回 Blob，拿不到 Content-Disposition）。
 */

const saveBlobMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/download", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/download")>()),
  saveBlob: saveBlobMock,
}));

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedDownload = vi.mocked(api.download as (e: string, o?: unknown) => Promise<Blob>);
const TODAY = datedFilename("x").replace("x-", "").replace(".csv", "");   // 与页面同一个"今天"

beforeEach(() => {
  vi.clearAllMocks();
  mockedDownload.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }));
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint.startsWith("/api/admin/logs/operations")) return { items: [], total: 0 };
    if (endpoint.startsWith("/api/admin/logs/stats")) return { total: 0, errors24h: 0, warns24h: 0, recentErrors: [] };
    if (endpoint.startsWith("/api/admin/logs")) return [];   // 请求日志列表接口直接返回数组
    return {};
  });
});
afterEach(() => vi.restoreAllMocks());

describe("操作日志导出", () => {
  it("走 api.download（不是 window.open），文件名 operations-YYYYMMDD.csv", async () => {
    render(<OperationLogsTab />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(String(mockedDownload.mock.calls[0][0])).toContain("/api/admin/logs/operations/export?");
    await waitFor(() => expect(saveBlobMock).toHaveBeenCalledTimes(1));
    expect(saveBlobMock.mock.calls[0][1]).toBe(`operations-${TODAY}.csv`);
    // 导出中 → 完成后清空提示
    await waitFor(() => expect(screen.queryByTestId("operation-export-msg")).not.toBeInTheDocument());
  });

  it("带筛选参数（user/action）时参数照旧拼在查询串里", async () => {
    render(<OperationLogsTab />);
    fireEvent.change(screen.getByPlaceholderText("操作人..."), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(String(mockedDownload.mock.calls[0][0])).toContain("user=admin");
  });

  it("401：不再提示「导出失败」", async () => {
    mockedDownload.mockRejectedValue(new Error("登录已过期，请重新登录"));
    render(<OperationLogsTab />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("operation-export-msg")).not.toBeInTheDocument());
    expect(screen.queryByText(/导出失败/)).not.toBeInTheDocument();
    expect(saveBlobMock).not.toHaveBeenCalled();
  });

  it("其它错误：可读提示", async () => {
    mockedDownload.mockRejectedValue(new Error("HTTP 500"));
    render(<OperationLogsTab />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));

    await waitFor(() => expect(screen.getByTestId("operation-export-msg")).toHaveTextContent("导出失败：HTTP 500"));
  });
});

describe("请求日志导出", () => {
  it("走 api.download，文件名 logs-YYYYMMDD.csv", async () => {
    render(<RequestLogsTab />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(String(mockedDownload.mock.calls[0][0])).toContain("/api/admin/logs/export?");
    await waitFor(() => expect(saveBlobMock).toHaveBeenCalledTimes(1));
    expect(saveBlobMock.mock.calls[0][1]).toBe(`logs-${TODAY}.csv`);
  });

  it("401：不提示「导出失败」；其它错误给可读提示", async () => {
    mockedDownload.mockRejectedValueOnce(new Error("登录已过期，请重新登录"));
    render(<RequestLogsTab />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("request-export-msg")).not.toBeInTheDocument());

    mockedDownload.mockRejectedValueOnce(new Error("导出被拒绝"));
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(screen.getByTestId("request-export-msg")).toHaveTextContent("导出失败：导出被拒绝"));
  });
});

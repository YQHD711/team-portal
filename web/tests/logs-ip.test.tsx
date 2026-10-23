import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import OperationLogsTab from "@/components/admin/logs/OperationLogsTab";
import RequestLogsTab from "@/components/admin/logs/RequestLogsTab";
import { api } from "@/lib/api";
import { extractRequestIp, parseLogDetail } from "@/lib/operationLog";

/**
 * 日志界面必须显示操作者真实 IP（后端 HTTPS + X-Forwarded-For 采集到的那个）。
 * 空值显示 —（而不是空白单元格），避免误读成“没有这一列”。
 */

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

function operationEntry(id: number, ipAddress?: string | null) {
  return {
    id, userId: 1, userName: "admin", action: "login", targetType: "user", targetId: "1",
    data: null, createdAt: "2026-10-01T08:00:00Z",
    ...(ipAddress === undefined ? {} : { ipAddress }),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("操作日志 · IP 列", () => {
  it("显示真实客户端 IP，空值显示 —", async () => {
    mockedGet.mockResolvedValue({
      total: 2,
      items: [operationEntry(1, "203.0.113.7"), operationEntry(2, null)],
    });

    render(<OperationLogsTab />);

    expect(screen.getByRole("columnheader", { name: "IP" })).toBeInTheDocument();
    expect(await screen.findByTestId("operation-ip-1")).toHaveTextContent("203.0.113.7");
    expect(screen.getByTestId("operation-ip-2")).toHaveTextContent("—");
  });

  it("接口没返回 ipAddress 字段时也不崩，按空值显示 —", async () => {
    mockedGet.mockResolvedValue({ total: 1, items: [operationEntry(3)] });

    render(<OperationLogsTab />);

    expect(await screen.findByTestId("operation-ip-3")).toHaveTextContent("—");
  });
});

describe("请求日志 · IP 列", () => {
  it("从 Detail JSON 的 ip 字段解析并展示；非法 detail 显示 —", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/admin/logs/stats")) {
        return { total: 2, errors24h: 0, warns24h: 0, recentErrors: [] };
      }
      return [
        {
          id: 10, level: "info", category: "http", message: "GET /api/x → 200",
          detail: JSON.stringify({ method: "GET", path: "/api/x", status: 200, ip: "198.51.100.23", scheme: "https" }),
          userName: "admin", createdAt: "2026-10-01T08:00:00Z",
        },
        {
          id: 11, level: "warn", category: "http", message: "GET /api/y → 404",
          detail: "detail-was-truncated-not-json", userName: null, createdAt: "2026-10-01T08:01:00Z",
        },
      ];
    });

    render(<RequestLogsTab />);

    expect(screen.getByRole("columnheader", { name: "IP" })).toBeInTheDocument();
    expect(await screen.findByTestId("request-ip-10")).toHaveTextContent("198.51.100.23");
    expect(screen.getByTestId("request-ip-11")).toHaveTextContent("—");
  });
});

describe("detail 解析工具", () => {
  it("extractRequestIp 只认非空字符串 ip", () => {
    expect(extractRequestIp(JSON.stringify({ ip: "198.51.100.9" }))).toBe("198.51.100.9");
    expect(extractRequestIp(JSON.stringify({ ip: "   " }))).toBeNull();
    expect(extractRequestIp(JSON.stringify({ ip: 123 }))).toBeNull();
    expect(extractRequestIp(JSON.stringify({ method: "GET" }))).toBeNull();
    expect(extractRequestIp(null)).toBeNull();
    expect(extractRequestIp("not json")).toBeNull();
  });

  it("parseLogDetail 拒绝数组/标量，避免把任意 JSON 当对象", () => {
    expect(parseLogDetail("[1,2,3]")).toBeNull();
    expect(parseLogDetail("42")).toBeNull();
    expect(parseLogDetail("null")).toBeNull();
    expect(parseLogDetail(JSON.stringify({ ip: "1.2.3.4" }))).toEqual({ ip: "1.2.3.4" });
  });
});

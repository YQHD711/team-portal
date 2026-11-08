import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BatteryByCodePage from "@/app/(protected)/b/[code]/page";
import BatteriesPage from "@/app/(protected)/batteries/page";
import { extractBatteryCode } from "@/app/(protected)/batteries/scan/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockPush = vi.fn();
const params = { code: "BAT-0001" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);

const battery = {
  id: 12,
  code: "BAT-0001",
  model: "6S 3300mAh",
  status: "in_stock",
  health: "正常",
  currentBorrowerId: null,
  currentBorrower: null,
  borrowedAt: null,
  notes: null,
  createdAt: "2026-11-08T10:00:00Z",
  updatedAt: "2026-11-08T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractBatteryCode", () => {
  it("纯编码原样返回", () => {
    expect(extractBatteryCode("BAT-0001")).toBe("BAT-0001");
  });

  it("从 /b/<code> 短链取编码（带查询串也不受干扰）", () => {
    expect(extractBatteryCode("https://team.example.com/b/BAT-0007?from=qr")).toBe("BAT-0007");
  });

  it("兼容 /i/<code> 短链", () => {
    expect(extractBatteryCode("https://team.example.com/i/BAT-0009")).toBe("BAT-0009");
  });

  it("空内容返回空串", () => {
    expect(extractBatteryCode("   ")).toBe("");
  });
});

describe("扫码落地页 /b/<编码>", () => {
  it("按编码查询并展示电池信息", async () => {
    mockedGet.mockResolvedValue(battery);
    render(<BatteryByCodePage />);

    expect(await screen.findByText("6S 3300mAh")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/battery/by-code/BAT-0001");
    expect(screen.getByRole("button", { name: /借出这块电池/ })).toBeInTheDocument();
  });

  it("在库电池点借出会调用借出接口", async () => {
    mockedGet.mockResolvedValue(battery);
    mockedPost.mockResolvedValue({});
    render(<BatteryByCodePage />);

    fireEvent.click(await screen.findByRole("button", { name: /借出这块电池/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/battery/12/borrow", {}));
  });

  it("借出状态显示借用人并提供归还按钮", async () => {
    mockedGet.mockResolvedValue({
      ...battery,
      status: "borrowed",
      currentBorrowerId: 7,
      currentBorrower: { id: 7, username: "zhangsan" },
      borrowedAt: "2026-11-08T10:00:00Z",
    });
    render(<BatteryByCodePage />);

    expect(await screen.findByText("zhangsan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /归还这块电池/ })).toBeInTheDocument();
  });

  it("编码不存在时给出提示", async () => {
    mockedGet.mockRejectedValue(new Error("404"));
    render(<BatteryByCodePage />);

    expect(await screen.findByText("没有找到这个电池编码")).toBeInTheDocument();
  });
});

describe("电池台账页 /batteries", () => {
  it("渲染电池列表和我的在借统计", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/battery?")) return [battery];
      if (endpoint === "/api/battery/mine") {
        return [{ id: 1, batteryId: 12, battery, userId: 1, user: null,
          borrowedAt: "2026-11-08T10:00:00Z", returnedAt: null, returnedByUserId: null, note: null }];
      }
      if (endpoint === "/api/battery/overdue") return [];
      return [];
    });
    render(<BatteriesPage />);

    expect(await screen.findByText("BAT-0001")).toBeInTheDocument();
    expect(screen.getByText("6S 3300mAh")).toBeInTheDocument();
    expect(screen.getByText("我在借")).toBeInTheDocument();
  });

  it("在库卡片点借出会调用借出接口", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/battery?")) return [battery];
      return [];
    });
    mockedPost.mockResolvedValue({});
    render(<BatteriesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /借出/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/battery/12/borrow", {}));
  });
});

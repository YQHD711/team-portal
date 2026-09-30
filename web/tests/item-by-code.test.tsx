import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ItemByCodePage from "@/app/(protected)/i/[code]/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "BAT-LIPO-6S3300MAH-2026-0007" }),
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

const item = {
  id: 12, name: "3S 3300mAh 25C 锂聚合物电池", category: "电池电源", quantity: 4,
  code: "BAT-LIPO-6S3300MAH-2026-0007", locationCode: "201-A-3-05", status: "available",
  grade: "A", unitPrice: 1200, department: { id: 1, name: "飞训部" }, updatedAt: "2026-09-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("扫码短链 /i/<编码>", () => {
  it("按编码取到物料，展示名称/库位/在库数量", async () => {
    mockedGet.mockResolvedValue(item);
    render(<ItemByCodePage />);

    // 必须真的按编码去查（这是扫码唯一的入口）
    expect(await screen.findByText("3S 3300mAh 25C 锂聚合物电池")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/inventory/by-code/BAT-LIPO-6S3300MAH-2026-0007");

    expect(screen.getByText("BAT-LIPO-6S3300MAH-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("201-A-3-05")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("A 级")).toBeInTheDocument();
    // 归属部门已移除：物料是队内共享的，页面上不该再出现部门名
    expect(screen.queryByText(/飞训部/)).not.toBeInTheDocument();
    // 页面上再放一个二维码，方便就地补打
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("库位没填时显示「未指定」而不是空白", async () => {
    mockedGet.mockResolvedValue({ ...item, locationCode: null });
    render(<ItemByCodePage />);

    expect(await screen.findByText("未指定")).toBeInTheDocument();
  });

  it("编码查不到时给出明确提示和出路", async () => {
    mockedGet.mockRejectedValue(new Error("404"));
    render(<ItemByCodePage />);

    expect(await screen.findByText("没有找到这个编码")).toBeInTheDocument();
    expect(screen.getByText("BAT-LIPO-6S3300MAH-2026-0007")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去库存页手动查找/ })).toBeInTheDocument();
  });
});

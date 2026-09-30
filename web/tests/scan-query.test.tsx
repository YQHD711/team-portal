import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ScanQueryModal from "@/components/inventory/ScanQueryModal";
import { extractCodeFromScan, canUseCamera } from "@/lib/scan";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

const item = {
  id: 12, name: "3S 3300mAh 25C 锂聚合物电池", category: "电池电源", quantity: 4,
  code: "BAT-LIPO-6S3300MAH-2026-0007", locationCode: "201-A-3-05", status: "available",
  grade: "A", unitPrice: 1200, updatedAt: "2026-09-01T10:00:00Z",
};

beforeEach(() => vi.clearAllMocks());

describe("扫码结果解析", () => {
  it("短链里取出编码，裸编码原样用", () => {
    // 我们印的二维码内容就是短链
    expect(extractCodeFromScan("https://team.example.com/i/BAT-LIPO-6S3300MAH-2026-0007"))
      .toBe("BAT-LIPO-6S3300MAH-2026-0007");
    // 别处印的裸编码
    expect(extractCodeFromScan("BAT-LIPO-6S3300MAH-2026-0007")).toBe("BAT-LIPO-6S3300MAH-2026-0007");
    // 手输小写 / URL 里带百分号转义 / 前后空白
    expect(extractCodeFromScan("  bat-lipo-6s3300mah-2026-0007  ")).toBe("BAT-LIPO-6S3300MAH-2026-0007");
    expect(extractCodeFromScan("http://8.137.161.160:3000/i/BAT%2DLIPO")).toBe("BAT-LIPO");
    expect(extractCodeFromScan("")).toBe("");
  });

  it("jsdom 里没有摄像头，判定为不可用", () => {
    // 这条同时锁住线上那种场景：非 HTTPS 时 navigator.mediaDevices 不存在
    expect(canUseCamera()).toBe(false);
  });
});

describe("二维码查询", () => {
  it("输入编码查到物料", async () => {
    mockedGet.mockResolvedValue(item);
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("物料编码"), { target: { value: "bat-lipo-6s3300mah-2026-0007" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/inventory/by-code/BAT-LIPO-6S3300MAH-2026-0007"));
    expect(await screen.findByText("3S 3300mAh 25C 锂聚合物电池")).toBeInTheDocument();
    expect(screen.getByText(/在库 4/)).toBeInTheDocument();
  });

  it("粘贴整条短链也能查（扫码枪与复制粘贴的常见形态）", async () => {
    mockedGet.mockResolvedValue(item);
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("物料编码"), { target: { value: "https://team.example.com/i/BAT-LIPO-6S3300MAH-2026-0007" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/inventory/by-code/BAT-LIPO-6S3300MAH-2026-0007"));
  });

  it("查不到时说明可能的原因，而不是静默失败", async () => {
    mockedGet.mockRejectedValue(new Error("404"));
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("物料编码"), { target: { value: "NOPE-2026-0001" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    expect(await screen.findByText(/没有找到编码 NOPE-2026-0001/)).toBeInTheDocument();
  });

  it("空输入不发请求", async () => {
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    expect(await screen.findByText("请输入或扫描物料编码")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("摄像头不可用时说明原因并给出替代办法", async () => {
    render(<ScanQueryModal onClose={vi.fn()} />);

    const tip = await screen.findByTestId("camera-unavailable");
    // 关键：要说清"为什么不能用"和"那怎么办"，不能只是按钮点了没反应
    expect(tip).toHaveTextContent(/摄像头/);
    expect(tip).toHaveTextContent(/手机相机|扫码枪|手动输入/);
    expect(screen.queryByTestId("start-camera")).not.toBeInTheDocument();
  });
});

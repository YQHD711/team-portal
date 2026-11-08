import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminDevicesPage from "@/app/(protected)/admin/devices/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const state = vi.hoisted(() => ({
  user: { id: 1, username: "admin", role: "admin" } as { id: number; username: string; role: string },
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: state.user, loading: false }),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

const device = {
  id: 1,
  name: "电池柜1采集器",
  deviceKey: "dev_6f3a1c2b9d4e8a70",
  type: "esp32",
  locationCode: "CAB-01",
  firmwareVersion: null,
  enabled: true,
  createdAt: "2026-11-08T10:00:00Z",
  lastSeenAt: "2026-11-08T10:05:00Z",
  lastSeenIp: "192.168.1.50",
  online: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 1, username: "admin", role: "admin" };
});

describe("设备管理 /admin/devices", () => {
  it("管理员看到设备列表与 DeviceKey", async () => {
    mockedGet.mockResolvedValue([device]);
    render(<AdminDevicesPage />);
    expect(await screen.findByText("电池柜1采集器")).toBeInTheDocument();
    expect(screen.getByText("dev_6f3a1c2b9d4e8a70")).toBeInTheDocument();
    expect(screen.getByText(/库位 CAB-01/)).toBeInTheDocument();
  });

  it("新增表单提交后展示一次性密钥", async () => {
    mockedGet.mockResolvedValue([]);
    vi.mocked(api.post).mockResolvedValue({ ...device, secret: "abc123" });
    render(<AdminDevicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /新增设备/ }));
    fireEvent.change(screen.getByPlaceholderText(/电池柜1采集器/), { target: { value: "新设备" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
    expect(await screen.findByText(/设备已创建/)).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("非管理员只看到权限提示", async () => {
    state.user = { id: 2, username: "member", role: "member" };
    render(<AdminDevicesPage />);
    expect(await screen.findByText(/只允许管理员维护/)).toBeInTheDocument();
  });
});

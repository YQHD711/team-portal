import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FirmwarePanel } from "@/components/flightlog/FirmwarePanel";
import { api, type DownloadOptions } from "@/lib/api";
import { saveBlob } from "@/lib/download";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), download: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/download", () => ({ saveBlob: vi.fn() }));

const sourcesPayload = {
  sources: [
    {
      id: "ardupilot", label: "ArduPilot", hint: "官方 firmware.ardupilot.org 目录",
      vehicles: [
        { id: "Plane", label: "固定翼 Plane" },
        { id: "Copter", label: "多旋翼 Copter" },
      ],
    },
    { id: "px4", label: "PX4", hint: "官方 GitHub Releases", vehicles: [] },
  ],
};
const versionsPayload = { items: [{ id: "stable", label: "稳定版 stable", prerelease: false }] };
const boardsPayload = {
  items: [
    { name: "Pixhawk6X", size: null },
    { name: "CubeOrange", size: null },
  ],
};
const assetsPayload = {
  items: [
    { name: "arduplane.abin", kind: "abin", label: "ABIN", size: 1674671 },
    { name: "arduplane.apj", kind: "apj", label: "APJ", size: 1538295 },
  ],
};

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockDownload = vi.mocked(
  api.download as (url: string, options?: DownloadOptions) => Promise<Blob>
);

/** 后端 payload 与约定字段名（items / sources）一致，避免前端臆造响应结构 */
function stubApiImpl(url: string) {
  if (url.startsWith("/api/firmware/sources")) return Promise.resolve(sourcesPayload);
  if (url.startsWith("/api/firmware/versions")) return Promise.resolve(versionsPayload);
  if (url.startsWith("/api/firmware/boards")) return Promise.resolve(boardsPayload);
  if (url.startsWith("/api/firmware/assets")) return Promise.resolve(assetsPayload);
  return Promise.resolve({});
}

function stubApi() {
  mockGet.mockImplementation(stubApiImpl);
}

const jwt = (role: string) => {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${enc({ alg: "HS256" })}.${enc({
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
  })}.sig`;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stubApi();
  mockDownload.mockResolvedValue(new Blob(["firmware"]));
});

describe("固件下载面板", () => {
  it("默认 ArduPilot/Plane，选板子后默认选 APJ 并按参数下载", async () => {
    render(<FirmwarePanel />);

    const vehicle = await screen.findByLabelText("机型");
    expect(vehicle).toHaveValue("Plane");
    await waitFor(() => expect(screen.getByLabelText("版本")).toHaveValue("stable"));

    // 等飞控板选项真正渲染出来再改 select，否则 jsdom 会忽略不存在的 option 值
    await screen.findByRole("option", { name: "Pixhawk6X" });
    fireEvent.change(screen.getByLabelText("飞控板"), { target: { value: "Pixhawk6X" } });

    const apj = await screen.findByRole("radio", { name: "arduplane.apj" });
    await waitFor(() => expect(apj).toBeChecked());

    fireEvent.click(screen.getByRole("button", { name: /下载固件/ }));

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    const url = mockDownload.mock.calls[0][0];
    expect(url).toContain("source=ardupilot");
    expect(url).toContain("vehicle=Plane");
    expect(url).toContain("version=stable");
    expect(url).toContain("board=Pixhawk6X");
    expect(url).toContain("asset=arduplane.apj");
    // 下载带进度回调与取消信号（进度条 + 「取消下载」靠它们工作）
    expect(mockDownload.mock.calls[0][1]).toEqual(
      expect.objectContaining({ onProgress: expect.any(Function), signal: expect.any(AbortSignal) })
    );
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "arduplane.apj");
  });

  it("下载中显示进度条，取消按钮会中断请求", async () => {
    // 用一个「卡住」的下载：进度回调先报 50%，再由测试触发取消
    let captured: DownloadOptions | undefined;
    let release: ((blob: Blob) => void) | undefined;
    mockDownload.mockImplementation((_url: string, options?: DownloadOptions) => {
      captured = options;
      options?.onProgress?.({ received: 512, total: 1024 });
      return new Promise<Blob>(resolve => { release = resolve; });
    });

    render(<FirmwarePanel />);
    await screen.findByLabelText("机型");
    await screen.findByRole("option", { name: "Pixhawk6X" });
    fireEvent.change(screen.getByLabelText("飞控板"), { target: { value: "Pixhawk6X" } });
    fireEvent.click(await screen.findByRole("button", { name: /下载固件/ }));

    const bar = await screen.findByRole("progressbar", { name: "固件下载进度" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    expect(screen.getByText(/已接收 512 B/)).toBeInTheDocument();

    const controller = captured?.signal;
    expect(controller?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "取消下载" }));
    expect(controller?.aborted).toBe(true);

    release?.(new Blob(["x"]));
  });

  it("assets 请求带上已选板子（否则会拿到别的板子的文件列表）", async () => {
    render(<FirmwarePanel />);
    await screen.findByLabelText("机型");
    await waitFor(() => expect(screen.getByLabelText("版本")).toHaveValue("stable"));

    await screen.findByRole("option", { name: "CubeOrange" });
    fireEvent.change(screen.getByLabelText("飞控板"), { target: { value: "CubeOrange" } });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("board=CubeOrange"))
    );
  });

  it("切到 PX4：隐藏机型下拉且请求不带 vehicle", async () => {
    render(<FirmwarePanel />);
    await screen.findByLabelText("机型");

    fireEvent.click(screen.getByRole("button", { name: "PX4" }));

    await waitFor(() => expect(screen.queryByLabelText("机型")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("source=px4"))
    );
    const px4Call = mockGet.mock.calls.map(c => c[0] as string).find(u => u.includes("source=px4"));
    expect(px4Call).not.toContain("vehicle=");
  });

  it("搜索框过滤飞控板（PX4 一个版本有 400+ 块）", async () => {
    render(<FirmwarePanel />);
    await screen.findByLabelText("机型");
    await screen.findByRole("option", { name: "CubeOrange" });

    fireEvent.change(screen.getByLabelText("搜索飞控板"), { target: { value: "cube" } });

    expect(screen.queryByRole("option", { name: "Pixhawk6X" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "CubeOrange" })).toBeInTheDocument();
  });

  it("上游目录不可达时显示后端给的原因，而不是空列表", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/firmware/sources")) return Promise.resolve(sourcesPayload);
      return Promise.reject(new Error("上游固件目录暂时不可达，请稍后重试"));
    });

    render(<FirmwarePanel />);

    expect(await screen.findByText(/上游固件目录暂时不可达/)).toBeInTheDocument();
  });

  it("缓存管理只对管理员显示", async () => {
    const { unmount } = render(<FirmwarePanel />);
    await screen.findByLabelText("机型");
    expect(screen.queryByText("固件缓存管理")).not.toBeInTheDocument();
    unmount();

    localStorage.setItem("token", jwt("admin"));
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/firmware/cache")) {
        return Promise.resolve({ items: [], totalBytes: 0, maxFileBytes: 67108864, root: "/data/firmware" });
      }
      return stubApiImpl(url);
    });
    render(<FirmwarePanel />);

    expect(await screen.findByText("固件缓存管理")).toBeInTheDocument();
  });
});

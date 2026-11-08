import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DeviceTerminalPage from "@/app/device/page";

beforeEach(() => {
  localStorage.clear();
});

describe("设备终端 /device", () => {
  it("未配置设备时显示配置表单", async () => {
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("配置本设备")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("dev_xxxxxxxx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存设备配置/ })).toBeInTheDocument();
  });

  it("已配置设备但未登录时显示使用人登录", async () => {
    localStorage.setItem("battery-device-key", "dev_test");
    localStorage.setItem("battery-device-secret", "secret");
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("使用人登录")).toBeInTheDocument();
    expect(screen.queryByText("配置本设备")).not.toBeInTheDocument();
  });

  it("有设备配置和会话时显示当前使用人", async () => {
    localStorage.setItem("battery-device-key", "dev_test");
    localStorage.setItem("battery-device-secret", "secret");
    localStorage.setItem("battery-device-session", "session-token");
    localStorage.setItem("battery-device-user", JSON.stringify({ id: 1, username: "zhangsan", role: "member" }));
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("zhangsan")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/扫电池标签/)).toBeInTheDocument();
  });
});

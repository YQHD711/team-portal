import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DeviceTerminalPage from "@/app/device/page";
import { extractUserIdentity } from "@/components/battery/batteryCode";

beforeEach(() => {
  localStorage.clear();
});

describe("extractUserIdentity（身份码解析）", () => {
  it("完整短链 /u/{slug} 取 slug", () => {
    expect(extractUserIdentity("https://team.example.com/u/u_b34a0763")).toBe("u_b34a0763");
  });
  it("纯学号/用户名原样返回", () => {
    expect(extractUserIdentity("20240001")).toBe("20240001");
  });
  it("空内容返回空串", () => {
    expect(extractUserIdentity("  ")).toBe("");
  });
});

describe("设备终端 /device", () => {
  it("未配置设备时显示配置表单", async () => {
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("配置本设备")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("dev_xxxxxxxx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存设备配置/ })).toBeInTheDocument();
  });

  it("已配置设备但未登录时显示识别使用人（身份码/学号）", async () => {
    localStorage.setItem("battery-device-key", "dev_test");
    localStorage.setItem("battery-device-secret", "secret");
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("识别使用人")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入学号/)).toBeInTheDocument();
    // 账号密码登录降级为可切换入口
    expect(screen.getByRole("button", { name: /改用账号密码登录/ })).toBeInTheDocument();
    expect(screen.queryByText("配置本设备")).not.toBeInTheDocument();
  });

  it("有设备配置和会话时显示当前使用人（显示姓名优先）", async () => {
    localStorage.setItem("battery-device-key", "dev_test");
    localStorage.setItem("battery-device-secret", "secret");
    localStorage.setItem("battery-device-session", "session-token");
    localStorage.setItem("battery-device-user", JSON.stringify({
      id: 1, username: "zhangsan", role: "member", displayName: "张三",
    }));
    render(<DeviceTerminalPage />);
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/扫电池标签/)).toBeInTheDocument();
  });
});

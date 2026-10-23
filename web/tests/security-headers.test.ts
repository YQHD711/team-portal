import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

/**
 * 守护 Permissions-Policy：HTTPS 上线后扫码要用摄像头，camera 必须对本站开放；
 * 同时 microphone/geolocation 仍然全禁。改错这里会让扫码按钮静默失效，故用测试锁住。
 */
describe("安全响应头", () => {
  it("Permissions-Policy 允许本站摄像头，禁止麦克风/定位", async () => {
    const groups = (await nextConfig.headers?.()) ?? [];
    const headers = groups.flatMap((group) => group.headers);
    const policy = headers.find((h) => h.key === "Permissions-Policy")?.value ?? "";

    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).not.toContain("camera=()");
  });
});

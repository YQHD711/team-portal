import { describe, it, expect, afterEach } from "vitest";
import { cameraUnavailableReason, canUseCamera } from "@/lib/scan";

const originalSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

/** 模拟部署环境：HTTPS（安全上下文）vs 明文 HTTP 裸 IP */
function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value });
}

function restore() {
  if (originalSecure) Object.defineProperty(window, "isSecureContext", originalSecure);
  else Reflect.deleteProperty(window, "isSecureContext");

  if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
}

afterEach(restore);

describe("HTTPS 下的摄像头扫码能力", () => {
  it("安全上下文 + navigator.mediaDevices → 可用（生产 HTTPS 场景）", () => {
    setSecureContext(true);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });

    expect(canUseCamera()).toBe(true);
    expect(cameraUnavailableReason()).toMatch(/浏览器不支持/);
  });

  it("明文 HTTP 即使有 mediaDevices 也不可用（旧部署场景，保留回归）", () => {
    setSecureContext(false);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });

    expect(canUseCamera()).toBe(false);
    expect(cameraUnavailableReason()).toMatch(/HTTPS/);
  });

  it("安全上下文但没有 mediaDevices → 不可用，提示换浏览器", () => {
    setSecureContext(true);
    Reflect.deleteProperty(navigator, "mediaDevices");

    expect(canUseCamera()).toBe(false);
    expect(cameraUnavailableReason()).toMatch(/手机相机|扫码枪|手动输入/);
  });
});

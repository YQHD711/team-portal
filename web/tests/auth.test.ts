import { describe, it, expect, beforeEach } from "vitest";
import { isStaff, isAdmin } from "@/lib/auth";

/** 生成 role 为指定值的假 JWT(仅 payload 用于解码 role) */
function setRole(role: string) {
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
  })).toString("base64url");
  localStorage.setItem("token", `header.${payload}.signature`);
}

describe("JWT role 解码(中文角色 UTF-8)", () => {
  beforeEach(() => localStorage.clear());

  it("部长的中文 role 应识别为 staff(非 admin)", () => {
    setRole("部长");
    expect(isStaff()).toBe(true);
    expect(isAdmin()).toBe(false);
  });

  it("admin 识别为 admin+staff", () => {
    setRole("admin");
    expect(isAdmin()).toBe(true);
    expect(isStaff()).toBe(true);
  });

  it("member 不是 staff", () => {
    setRole("member");
    expect(isStaff()).toBe(false);
    expect(isAdmin()).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { isStaff, isAdmin } from "@/lib/auth";

/** 生成 role 为指定值的假 JWT。filler 用 U+00FF(UTF-8 0xC3 0xBF)保证 base64url 输出含 url-safe 字符(`_`),
 * 使未做 base64url 归一化的旧解码(atob 直接解析)必然抛错 → 回归可被检测。 */
function setRole(role: string) {
  const obj = {
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
    filler: "ÿ".repeat(12),
  };
  const payload = Buffer.from(JSON.stringify(obj)).toString("base64url"); // 无填充、url-safe
  if (!/[-_]/.test(payload)) throw new Error("expected url-safe char in payload: " + payload);
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

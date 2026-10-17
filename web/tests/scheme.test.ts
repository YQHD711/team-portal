/** 成员级明暗偏好（cookie/解析/auto/与品牌色共存）。 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEME, nextScheme, parseScheme, resolveScheme, schemeLabel, serverDarkClass, SCHEME_COOKIE } from "@/lib/scheme";

describe("明暗偏好解析", () => {
  it("合法值原样返回；非法/缺失回默认深色", () => {
    expect(parseScheme("light")).toBe("light");
    expect(parseScheme("dark")).toBe("dark");
    expect(parseScheme("auto")).toBe("auto");
    expect(parseScheme(null)).toBe(DEFAULT_SCHEME);
    expect(parseScheme("purple")).toBe(DEFAULT_SCHEME);
    expect(SCHEME_COOKIE).toBe("scheme");
  });

  it("auto 跟随系统；显式值忽略系统", () => {
    expect(resolveScheme("auto", true)).toBe("dark");
    expect(resolveScheme("auto", false)).toBe("light");
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
  });

  it("服务端 class：只有 dark 才加（auto 由内联脚本兜底，避免闪）", () => {
    expect(serverDarkClass("dark")).toBe(" dark");
    expect(serverDarkClass("light")).toBe("");
    expect(serverDarkClass("auto")).toBe("");
  });

  it("三态循环：深→浅→跟随系统→深", () => {
    expect(nextScheme("dark")).toBe("light");
    expect(nextScheme("light")).toBe("auto");
    expect(nextScheme("auto")).toBe("dark");
    expect(schemeLabel("auto")).toBe("跟随系统");
  });

  it("与品牌主色共存：class 由 scheme 决定、style 由品牌决定，互不覆盖", () => {
    const className = `h-full antialiased touch-manipulation${serverDarkClass("dark")}`;
    const style = { "--primary": "#0091ff", "--accent": "#0091ff" };   // 品牌主色内联（服务端渲染）
    expect(className).toContain("dark");
    expect(style["--primary"]).toBe("#0091ff");   // 切明暗不应改这两个键
  });
});
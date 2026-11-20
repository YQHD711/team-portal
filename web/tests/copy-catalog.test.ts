import { describe, it, expect } from "vitest";
import { CATALOG, COPY_GROUPS, defaultText, keysByGroup } from "@/lib/copy/catalog";
import type { CopyEntry } from "@/lib/copy/catalog";
import { NAV_COPY } from "@/lib/copy/groups/nav";
import { COMMON_COPY } from "@/lib/copy/groups/common";
import { AUTH_COPY } from "@/lib/copy/groups/auth";
import { TOPBAR_COPY } from "@/lib/copy/groups/topbar";
import { EMPTY_COPY } from "@/lib/copy/groups/empty";

const entries = Object.entries(CATALOG) as [string, CopyEntry][];

describe("界面文案目录", () => {
  it("收录了第 1 批全部文案", () => {
    expect(entries.length).toBeGreaterThan(40);
  });

  it("key 统一为 模块.区域 的小写点分格式", () => {
    for (const [key] of entries) {
      expect(key, key).toMatch(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/);
    }
  });

  it("每条都有非空默认值，且不超过建议最大长度", () => {
    for (const [key, entry] of entries) {
      expect(entry.text.trim(), key).not.toBe("");
      if (entry.max) expect(entry.text.length, key).toBeLessThanOrEqual(entry.max);
    }
  });

  it("分组都是管理页认识的已知分组", () => {
    for (const [key, entry] of entries) {
      expect(COPY_GROUPS, key).toContain(entry.group);
    }
  });

  it("各分组之间没有重复 key（否则后合并的会静默覆盖）", () => {
    const groups = [NAV_COPY, TOPBAR_COPY, COMMON_COPY, AUTH_COPY, EMPTY_COPY];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const key of Object.keys(group)) {
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it("占位符只使用已知变量（目前仅 {teamName}）", () => {
    const allowed = new Set(["teamName"]);
    for (const [key, entry] of entries) {
      for (const m of entry.text.matchAll(/\{([a-zA-Z]+)\}/g)) {
        expect(allowed.has(m[1]), key).toBe(true);
      }
    }
  });

  it("defaultText / keysByGroup 与目录一致", () => {
    expect(defaultText("nav.inventory")).toBe("零件库存");
    expect(defaultText("not.exists")).toBeUndefined();
    const navKeys = keysByGroup("导航");
    expect(navKeys).toContain("nav.inventory");
    expect(navKeys.every((k) => CATALOG[k].group === "导航")).toBe(true);
  });
});

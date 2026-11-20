import { describe, it, expect } from "vitest";
import { TOURS, getTour, visibleTours, matchesEntry, tourForPath, visibleSteps } from "@/lib/tours/registry";
import type { TourDef } from "@/lib/tours/types";

/** 构造一条临时引导（只测过滤逻辑，不依赖真实内容） */
function fakeTour(over: Partial<TourDef>): TourDef {
  return {
    key: "fake",
    title: "临时",
    roles: ["member", "部长", "admin"],
    entry: "/fake",
    autoStart: true,
    version: 1,
    steps: [{ id: "s1", target: "t", title: "t", body: "b" }],
    ...over,
  };
}

describe("引导注册表", () => {
  it("真实引导结构完整：key 唯一、步骤 id 唯一、版本合法", () => {
    const keys = TOURS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tour of TOURS) {
      expect(tour.version).toBeGreaterThanOrEqual(1);
      expect(tour.steps.length).toBeGreaterThan(0);
      const ids = tour.steps.map((s) => s.id);
      expect(new Set(ids).size, tour.key).toBe(ids.length);
      for (const s of tour.steps) {
        expect(s.target, tour.key + "/" + s.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(s.title.trim(), tour.key + "/" + s.id).not.toBe("");
      }
    }
  });

  it("按角色过滤：成员看不到 admin 专属引导", () => {
    const adminOnly = fakeTour({ key: "admin-only", roles: ["admin"], entry: "/admin/x" });
    const all = [...TOURS, adminOnly];
    expect(visibleTours("member", all).some((t) => t.key === "admin-only")).toBe(false);
    expect(visibleTours("部长", all).some((t) => t.key === "admin-only")).toBe(false);
    expect(visibleTours("admin", all).some((t) => t.key === "admin-only")).toBe(true);
  });

  it("非法/缺失角色不返回任何引导", () => {
    expect(visibleTours(null)).toEqual([]);
    expect(visibleTours(undefined)).toEqual([]);
    expect(visibleTours("guest")).toEqual([]);
  });

  it("路径匹配：首页精确、功能页允许子路径", () => {
    expect(matchesEntry("/", "/")).toBe(true);
    expect(matchesEntry("/", "/inventory")).toBe(false);
    expect(matchesEntry("/inventory", "/inventory")).toBe(true);
    expect(matchesEntry("/inventory", "/inventory/layout")).toBe(true);
    expect(matchesEntry("/inventory", "/inventory-x")).toBe(false);
  });

  it("按路径选出应自动开始的引导，且更长 entry 优先", () => {
    const specific = fakeTour({ key: "specific", entry: "/inventory/layout" });
    const all = [...TOURS, specific];
    expect(tourForPath("/", "member", all)?.key).toBe("welcome");
    expect(tourForPath("/batteries", "member", all)?.key).toBe("battery");
    expect(tourForPath("/inventory/layout", "member", all)?.key).toBe("specific");
    expect(tourForPath("/inventory", "member", all)?.key).toBe("inventory");
    expect(tourForPath("/nothing-here", "member", all)).toBeUndefined();
    expect(tourForPath("/batteries", null, all)).toBeUndefined();
  });

  it("步骤级角色过滤", () => {
    const tour = fakeTour({
      key: "mixed",
      steps: [
        { id: "all", target: "a", title: "a", body: "b" },
        { id: "staff", target: "b", title: "b", body: "b", roles: ["部长", "admin"] },
      ],
    });
    expect(visibleSteps(tour, "member").map((s) => s.id)).toEqual(["all"]);
    expect(visibleSteps(tour, "部长").map((s) => s.id)).toEqual(["all", "staff"]);
    expect(visibleSteps(tour, null)).toEqual([]);
  });

  it("getTour 能按 key 取回，未知 key 返回 undefined", () => {
    expect(getTour("battery")?.title).toBe("电池借还");
    expect(getTour("nope")).toBeUndefined();
  });
});

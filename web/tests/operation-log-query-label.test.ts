import { describe, it, expect } from "vitest";
import { actionColors, actionLabel, baseActionLabels, summarize } from "@/lib/operationLog";

/**
 * 扫码/手输编码查询会往「操作日志」写 action="query" 的记录。
 * 日志页的「操作类型」列走 actionLabel()，筛选下拉直接由 baseActionLabels 生成 ——
 * 少一个中文标签，日志页上就会显示成生英文的 "query"，而且筛不出来。
 */
describe("操作日志 · 查询动作标签", () => {
  it("query 有中文标签，且出现在筛选下拉的数据源里", () => {
    expect(actionLabel("query", "item")).toBe("查询");
    expect(baseActionLabels["query"]).toBe("查询");
    expect(actionColors["query"]).toBeTruthy();
  });

  it("命中与未命中的 data 都能在列表里摘要出来（result 字段做主区分）", () => {
    const hit = JSON.stringify({ result: "hit", code: "PW-1", itemId: 7, name: "prop", locationCode: "1012-A-1-01" });
    const miss = JSON.stringify({ result: "miss", code: "NOPE" });
    expect(summarize(hit)).toContain("result: hit");
    expect(summarize(miss)).toBe("result: miss · code: NOPE");
  });
});

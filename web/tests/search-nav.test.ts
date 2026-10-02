import { describe, it, expect } from "vitest";
import { searchTargetUrl } from "@/lib/searchNav";

describe("searchTargetUrl：搜索结果跳转地址（追加而不是重建）", () => {
  it("/study 这种没参数的（说明类文档）→ 追加 ?q=", () => {
    expect(searchTargetUrl("/study", "cuadc")).toBe("/study?q=cuadc");
  });

  it("已带 lesson=（课时）→ 保留 lesson、追加 &q=，绝不丢参数", () => {
    const p = "/study?lesson=%E9%A3%9E%E8%AE%AD%E9%83%A8%2F%E5%AD%A6%E4%B9%A0%E5%BA%93%2F01.md";
    expect(searchTargetUrl(p, "cuadc")).toBe(`${p}&q=cuadc`);
  });

  it("已有 q 不重复追加；关键词做 URL 编码；两边空格裁掉", () => {
    expect(searchTargetUrl("/study?lesson=x&q=old", "new")).toBe("/study?lesson=x&q=old");
    expect(searchTargetUrl("/study", "中 等")).toBe("/study?q=%E4%B8%AD%20%E7%AD%89");
    expect(searchTargetUrl("/study", "  cuadc  ")).toBe("/study?q=cuadc");
  });

  it("空关键词 / 非学习库结果 → 原样返回（知识库结果自己带 q）", () => {
    expect(searchTargetUrl("/study", "   ")).toBe("/study");
    expect(searchTargetUrl("/study?lesson=x", "")).toBe("/study?lesson=x");
    expect(searchTargetUrl("/admin/knowledge?path=a.md&q=k", "cuadc")).toBe("/admin/knowledge?path=a.md&q=k");
    expect(searchTargetUrl("/inventory?id=3", "cuadc")).toBe("/inventory?id=3");
    expect(searchTargetUrl("/studyx", "cuadc")).toBe("/studyx");
  });
});

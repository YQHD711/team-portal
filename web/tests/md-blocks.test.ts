import { describe, it, expect } from "vitest";
import { replaceBlock, splitMarkdownBlocks } from "@/lib/mdBlocks";

/**
 * 这是"块级编辑只动你点的那一块"的机制证据：
 * 切片首尾相接 === 原文（逐字），所以改一块时其它块一个字符都不会变。
 */

/** 含 mermaid / 代码块 / 表格 / 列表 / 引用 / 中英文 / 行内代码 / CRLF 的刁钻文档 */
const DOC = [
  "# 第一节：认识 航模 (UAV)",
  "",
  "第一段正文，含 `行内代码` 与 **加粗**，还有 English words。",
  "",
  "```mermaid",
  "graph TD;",
  "  A[起飞] --> B[巡航];",
  "  B --> C[降落];",
  "```",
  "",
  "## 1.1 参数表",
  "",
  "| 参数 | 值 | 说明 |",
  "| --- | --- | --- |",
  "| 翼展 | 1200mm | 主翼总长 |",
  "| 重量 | 850g | 不含电池 |",
  "",
  "- 列表项一",
  "- 列表项二",
  "  - 嵌套项（保持缩进）",
  "",
  "> 引用一段话，",
  "> 跨两行。",
  "",
  "```bash",
  "echo \"不要动我\"   # 英文 + 引号 + 缩进",
  "```",
  "",
  "最后一段：中英混排 mixed text 结尾。",
].join("\n");

describe("splitMarkdownBlocks：切片是原文的逐字划分", () => {
  it("拼回去 === 原文（逐字符）", () => {
    const blocks = splitMarkdownBlocks(DOC);
    expect(blocks.map(b => b.text).join("")).toBe(DOC);
    expect(blocks.length).toBeGreaterThan(5);
  });

  it("切片下标与 text 完全一致（start/end 可用来定位）", () => {
    for (const b of splitMarkdownBlocks(DOC)) {
      expect(DOC.slice(b.start, b.end)).toBe(b.text);
    }
  });

  it("围栏（含 mermaid）整块不被切开；表格/列表/引用各自成块", () => {
    const blocks = splitMarkdownBlocks(DOC);
    const fence = blocks.find(b => b.kind === "fence" && b.text.includes("graph TD"));
    expect(fence!.text).toContain("B[巡航]");
    expect(fence!.text).toContain("```");           // 开闭围栏都在同一块里
    // 表格块包含表头、分隔行和两行数据
    const table = blocks.find(b => b.text.includes("| 翼展 |"));
    expect(table!.kind).toBe("table");
    expect(table!.text).toContain("| --- |");
    expect(table!.text).toContain("| 重量 |");
    // 标题行各自成块
    expect(blocks.filter(b => b.kind === "heading").map(b => b.text.trim())).toEqual(["# 第一节：认识 航模 (UAV)", "## 1.1 参数表"]);
  });

  it("CRLF 文档同样逐字划分", () => {
    const crlf = "# 标题\r\n\r\n正文一\r\n\r\n正文二\r\n";
    const blocks = splitMarkdownBlocks(crlf);
    expect(blocks.map(b => b.text).join("")).toBe(crlf);
  });

  it("边界：空文档、只有空行、未闭合围栏", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
    expect(splitMarkdownBlocks("\n\n").map(b => b.text).join("")).toBe("\n\n");
    const open = "正文\n\n```js\nlet a = 1;\n";
    expect(splitMarkdownBlocks(open).map(b => b.text).join("")).toBe(open);
  });
});

describe("replaceBlock：只替换那一块，其余逐字不变", () => {
  const blocks = splitMarkdownBlocks(DOC);
  const paraIdx = blocks.findIndex(b => b.text.startsWith("第一段正文"));
  const before = DOC.slice(0, blocks[paraIdx].start);
  const after = DOC.slice(blocks[paraIdx].end);

  it("改一个段落：其余部分**逐字符相同**（含 mermaid/代码/表格/中英文）", () => {
    const next = replaceBlock(DOC, blocks[paraIdx], "第一段正文改过了，只动这一块。");

    expect(next.slice(0, blocks[paraIdx].start)).toBe(before);
    expect(next.endsWith(after)).toBe(true);
    expect(next).toContain("第一段正文改过了，只动这一块。");
    expect(next).not.toContain("第一段正文，含 `行内代码`");
    // 未编辑内容的关键片段仍在，且没有被重排
    expect(next).toContain("```mermaid\ngraph TD;\n  A[起飞] --> B[巡航];\n  B --> C[降落];\n```");
    expect(next).toContain("| 翼展 | 1200mm | 主翼总长 |");
    expect(next).toContain('echo "不要动我"   # 英文 + 引号 + 缩进');
  });

  it("改标题：同样只动那一行", () => {
    const h = blocks.find(b => b.kind === "heading")!;
    const next = replaceBlock(DOC, h, "## 换了个标题");
    // 整篇 = 新标题 + 原文剩余部分（标题后原有的空行也照旧）
    expect(next).toBe("## 换了个标题\n\n" + DOC.slice(h.end));
  });

  it("CRLF 文档替换后仍是 CRLF，空行数量不变", () => {
    const crlf = "# 标题\r\n\r\n正文一\r\n\r\n正文二\r\n";
    const bs = splitMarkdownBlocks(crlf);
    const target = bs.find(b => b.text.startsWith("正文一"))!;
    const next = replaceBlock(crlf, target, "正文一改");
    expect(next).toBe("# 标题\r\n\r\n正文一改\r\n\r\n正文二\r\n");
    expect(next.includes("\n\n\n")).toBe(false);
  });

  it("列表整块替换：块内缩进结构由作者自己控制", () => {
    const list = blocks.find(b => b.kind === "list")!;
    const next = replaceBlock(DOC, list, "- 新项一\n  - 新的嵌套项");
    expect(next).toContain("- 新项一\n  - 新的嵌套项");
    expect(next).toContain("> 引用一段话，");   // 后面的块没被动
  });
});

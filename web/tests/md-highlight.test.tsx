import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { splitHighlight, wrapHighlights, HIGHLIGHT_TESTID } from "@/lib/mdHighlight";

function Harness({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

describe("splitHighlight：命中切片", () => {
  it("没有命中词/没有命中时原样返回", () => {
    expect(splitHighlight("正文", "")).toEqual([{ text: "正文", hit: false }]);
    expect(splitHighlight("正文", "不存在")).toEqual([{ text: "正文", hit: false }]);
    expect(splitHighlight("", "中等")).toEqual([{ text: "", hit: false }]);
  });

  it("多处命中、大小写不敏感，且命中词按字面量处理（不是正则）", () => {
    expect(splitHighlight("a中等b中等", "中等")).toEqual([
      { text: "a", hit: false }, { text: "中等", hit: true }, { text: "b", hit: false }, { text: "中等", hit: true },
    ]);
    expect(splitHighlight("DeepSeek V4", "deepseek")).toEqual([
      { text: "DeepSeek", hit: true }, { text: " V4", hit: false },
    ]);
    // "a.b" 里的 . 是普通字符：不该匹配 "axb"
    expect(splitHighlight("xaxbx", "a.b")).toEqual([{ text: "xaxbx", hit: false }]);
    expect(splitHighlight("xa.bx", "a.b")).toEqual([
      { text: "x", hit: false }, { text: "a.b", hit: true }, { text: "x", hit: false },
    ]);
  });
});

describe("wrapHighlights：只在正文文本上包 <mark>", () => {
  it("字符串、数组、白名单内联元素里的命中都会包上；<code> 不动", () => {
    const { container } = render(
      <Harness>
        {wrapHighlights(["前", <strong key="s">中等</strong>, <code key="c">中等</code>], "中等")}
      </Harness>
    );
    const marks = container.querySelectorAll(`[data-testid="${HIGHLIGHT_TESTID}"]`);
    expect(marks).toHaveLength(1);                    // 只有 <strong> 里的那处
    expect(marks[0].closest("strong")).not.toBeNull();
    expect(container.querySelector("code")!.querySelector("mark")).toBeNull();
  });

  it("空命中词原样返回（调用方据此保证不传 prop 时渲染不变）", () => {
    const { container } = render(<Harness>{wrapHighlights("中等", "  ")}</Harness>);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("中等");
  });
});

describe("MarkdownRenderer：搜索高亮（独立关注点，不碰 markdown 源文本）", () => {
  it("段落/表格单元格里的命中包成 mark，行内代码与代码块里的不算", () => {
    const md = [
      "# 标题里的中等",
      "",
      "正文里有中等两个字，行内 `中等` 代码不算。",
      "",
      "| 列 |",
      "| --- |",
      "| 中等 |",
      "",
      "```bash",
      "echo 中等",
      "```",
    ].join("\n");

    render(<MarkdownRenderer content={md} highlight="中等" />);

    const marks = screen.getAllByTestId(HIGHLIGHT_TESTID);
    // h1 1 处 + 段落 1 处（行内代码那处不算）+ 表格单元格 1 处 = 3
    expect(marks).toHaveLength(3);
    const code = document.querySelector("pre, code")!;
    expect(code.textContent).toBe("中等");
    expect(code.querySelector(`[data-testid="${HIGHLIGHT_TESTID}"]`)).toBeNull();
    expect(document.querySelector("pre")!.textContent).toContain("echo 中等");
    expect(document.querySelector("pre")!.querySelector(`[data-testid="${HIGHLIGHT_TESTID}"]`)).toBeNull();
  });

  it("不传 highlight：不产生任何 mark，也不引入额外包裹（回归）", () => {
    const md = "正文里有中等两个字。\n\n```bash\necho 中等\n```";
    const { container } = render(<MarkdownRenderer content={md} />);

    expect(container.querySelector(`[data-testid="${HIGHLIGHT_TESTID}"]`)).toBeNull();
    expect(container.querySelector("p")).toHaveTextContent("正文里有中等两个字。");
    expect(container.textContent).toContain("echo 中等");
  });

  it("站内 .md 链接的 #锚点会随 onNavigate 一起传出去", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer content={"[章程](../章程.md#附则)"} docPath="飞训部/学习库/01/课.md" onNavigate={onNavigate} />);

    screen.getByRole("link", { name: "章程" }).click();

    expect(onNavigate).toHaveBeenCalledWith("飞训部/学习库/章程.md", "附则");
  });
});

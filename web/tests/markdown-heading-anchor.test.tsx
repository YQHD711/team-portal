import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { extractToc } from "@/lib/studyNav";

describe("MarkdownRenderer 标题锚点", () => {
  it("标题带 id —— 否则学习库右侧大纲点了不会跳", () => {
    render(<MarkdownRenderer content={"## 认识 航模\n\n正文\n\n### 小节!"} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "认识-航模");
    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute("id", "小节");
  });

  it("渲染出的 id 与大纲抽出的锚点一致（两处规则必须同源）", () => {
    const md = "## 认识 航模\n\n正文\n\n### 安全 红线";

    render(<MarkdownRenderer content={md} />);

    const toc = extractToc(md);
    expect(toc).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", toc[0].id);
    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute("id", toc[1].id);
  });
});

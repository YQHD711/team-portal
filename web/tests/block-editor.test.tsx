import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BlockEditor } from "@/components/knowledge/BlockEditor";

/**
 * 块级就地编辑 —— 本任务最重要的验收点：
 * **未编辑的块，写回去的 markdown 必须逐字符不变**（含 mermaid / 代码块 / 表格 / 中英文）。
 */

const DOC = [
  "# 认识航模",
  "",
  "第一段正文，含 `行内代码` 与 English words。",
  "",
  "```mermaid",
  "graph TD;",
  "  A[起飞] --> B[降落];",
  "```",
  "",
  "| 参数 | 值 |",
  "| --- | --- |",
  "| 翼展 | 1200mm |",
  "",
  "- 列表项一",
  "- 列表项二",
  "",
  "最后一段：中英混排 mixed text。",
].join("\n");

/** 受控外壳：保存后父组件更新 content（和真实页面一样） */
function Harness({ onSave }: { onSave?: (next: string) => void | Promise<void> }) {
  const [content, setContent] = useState(DOC);
  return <BlockEditor content={content} label="课时" onSave={async next => { await onSave?.(next); setContent(next); }} />;
}

const blockWith = (text: string) => {
  const el = screen.getAllByTestId("md-block").find(b => b.textContent?.includes(text));
  if (!el) throw new Error(`没找到含「${text}」的块`);
  return el;
};

describe("BlockEditor：只改你点的那一块", () => {
  it("点块的「编辑」→ 变成 textarea（内容是这一块的原始 markdown）", () => {
    render(<Harness onSave={vi.fn()} />);

    fireEvent.click(within(blockWith("第一段正文")).getByTestId("md-block-edit"));

    const editor = screen.getByTestId("md-block-editor");
    expect(editor).toHaveValue("第一段正文，含 `行内代码` 与 English words。");
  });

  it("保存后：其余部分**逐字符不变**，只有这一块变成新内容（并立即重新渲染）", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    fireEvent.click(within(blockWith("第一段正文")).getByTestId("md-block-edit"));
    fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: "第一段正文改过了。" } });
    fireEvent.click(screen.getByTestId("md-block-save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const next = onSave.mock.calls[0][0] as string;

    // 逐字符校验：只替换了那一段，前后两半与原文完全一致
    const head = DOC.indexOf("第一段正文");
    const tailStart = DOC.indexOf("```mermaid");
    expect(next.slice(0, head)).toBe(DOC.slice(0, head));
    expect(next.slice(next.indexOf("```mermaid"))).toBe(DOC.slice(tailStart));
    expect(next).toContain("第一段正文改过了。");
    expect(next).not.toContain("English words");

    // 保存后重新渲染：新内容出现、编辑框收起
    expect(await screen.findByText("第一段正文改过了。")).toBeInTheDocument();
    expect(screen.queryByTestId("md-block-editor")).not.toBeInTheDocument();
  });

  it("取消 / Esc 不保存", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    fireEvent.click(within(blockWith("第一段正文")).getByTestId("md-block-edit"));
    fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: "不该被保存" } });
    fireEvent.click(screen.getByTestId("md-block-cancel"));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(within(blockWith("第一段正文")).getByTestId("md-block-edit"));
    fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: "也不该被保存" } });
    fireEvent.keyDown(screen.getByTestId("md-block-editor"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId("md-block-editor")).not.toBeInTheDocument();
  });

  it("保存失败时把错误显示出来，编辑框不关", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("没有写入权限"));
    render(<Harness onSave={onSave} />);

    fireEvent.click(within(blockWith("第一段正文")).getByTestId("md-block-edit"));
    fireEvent.change(screen.getByTestId("md-block-editor"), { target: { value: "改一下" } });
    fireEvent.click(screen.getByTestId("md-block-save"));

    expect(await screen.findByTestId("md-block-error")).toHaveTextContent("没有写入权限");
    expect(screen.getByTestId("md-block-editor")).toBeInTheDocument();
  });

  it("不传 onSave 时：没有任何编辑入口，渲染与只读正文一致（回归）", () => {
    render(<BlockEditor content={DOC} />);

    expect(screen.queryAllByTestId("md-block")).toHaveLength(0);
    expect(screen.queryByTestId("md-block-edit")).not.toBeInTheDocument();
    expect(screen.getByText(/English words/)).toBeInTheDocument();
  });
});

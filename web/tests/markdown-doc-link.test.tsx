import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { resolveDocLink } from "@/lib/markdownAssets";

const DOC = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const DOC_DIR = "飞训部/学习库/01-入门筑基";

describe("resolveDocLink：相对 .md 解析成站内文档路径", () => {
  it("同目录 / ./ / 多级目录", () => {
    expect(resolveDocLink("02-安全规范.md", DOC)).toBe(`${DOC_DIR}/02-安全规范.md`);
    expect(resolveDocLink("./02-安全规范.md", DOC)).toBe(`${DOC_DIR}/02-安全规范.md`);
    expect(resolveDocLink("讲义/第一讲.md", DOC)).toBe(`${DOC_DIR}/讲义/第一讲.md`);
  });

  it("../ 上跳（用户举例：课程里引用上一级的章程）", () => {
    expect(resolveDocLink("../章程.md", DOC)).toBe("飞训部/学习库/章程.md");
    expect(resolveDocLink("../飞行部/规章/安全条例.md", DOC)).toBe("飞训部/学习库/飞行部/规章/安全条例.md");
    expect(resolveDocLink("../../公共/资料.md", DOC)).toBe("飞训部/公共/资料.md");
    // 一路点到知识库根也是合法的：根目录下的文档
    expect(resolveDocLink("../../../章程.md", DOC)).toBe("章程.md");
  });

  it("../ 越出知识库根 → 不拦截", () => {
    expect(resolveDocLink("../../../../章程.md", DOC)).toBeNull();
    expect(resolveDocLink("/绝对/路径.md", DOC)).toBeNull();
  });

  it("带 #锚点：仍然拦截，但只切文档（锚点丢掉）", () => {
    expect(resolveDocLink("02-安全规范.md#第二节", DOC)).toBe(`${DOC_DIR}/02-安全规范.md`);
    expect(resolveDocLink("../章程.md#附则", DOC)).toBe("飞训部/学习库/章程.md");
  });

  it("外链 / 邮件 / 其它协议 / 纯锚点 / 非 .md 一律放行", () => {
    for (const href of [
      "https://ardupilot.org/plane/docs/",
      "http://example.com/a.md",
      "//cdn.example.com/a.md",
      "mailto:someone@example.com",
      "tel:123456",
      "javascript:alert(1)",
      "#第二节",
      "接线示意.png",
      "附件.pdf",
      "说明",
      "",
      "   ",
      "/inventory/layout",
    ]) {
      expect(resolveDocLink(href, DOC), href).toBeNull();
    }
  });

  it("docPath 缺失 / 没有目录时按文档所在目录解析", () => {
    expect(resolveDocLink("x.md", undefined)).toBeNull();
    expect(resolveDocLink("x.md", "")).toBeNull();
    expect(resolveDocLink("x.md", "总览.md")).toBe("x.md");
    expect(resolveDocLink("./y/x.md", "总览.md")).toBe("y/x.md");
  });

  it("react-markdown 会把中文 href 百分号编码、Windows 反斜杠也要认", () => {
    expect(resolveDocLink("%E7%AB%A0%E7%A8%8B.md", DOC)).toBe(`${DOC_DIR}/章程.md`);
    expect(resolveDocLink("..\\章程.md", DOC)).toBe("飞训部/学习库/章程.md");
    expect(resolveDocLink("01-%E8%AE%A4%E8%AF%86.md", "总览.md")).toBe("01-认识.md");
  });
});

describe("MarkdownRenderer：站内 .md 链接点得动（走 onNavigate）", () => {
  it("点相对 .md 链接：调 onNavigate(解析后的路径) 并阻止浏览器跳转", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer content={"[安全规范](./02-安全规范.md)"} docPath={DOC} onNavigate={onNavigate} />);

    const a = screen.getByRole("link", { name: "安全规范" });
    expect(a).toHaveAttribute("data-testid", "internal-doc-link");
    // fireEvent 返回 false 表示 preventDefault 被调用（否则浏览器会真的导航走 → 404）
    const ev = createEvent.click(a);
    expect(fireEvent(a, ev)).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(`${DOC_DIR}/02-安全规范.md`);
  });

  it("中文文件名的链接（react-markdown 会编码成 %E7%AB%A0...）也能对上", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer content={"[章程](../章程.md)"} docPath={DOC} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("link", { name: "章程" }));

    expect(onNavigate).toHaveBeenCalledWith("飞训部/学习库/章程.md");
  });

  it("外链 / 纯锚点 / 非 .md 即使传了 onNavigate 也不拦", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer
      content={"[外](https://a.example.com/x.md)\n\n[锚](#sec)\n\n[图](a.png)\n\n[附件](报表.pdf)"}
      docPath={DOC} onNavigate={onNavigate} />);

    // 外链仍是新窗口打开
    expect(screen.getByRole("link", { name: "外" })).toHaveAttribute("target", "_blank");
    for (const name of ["外", "锚", "图", "附件"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("data-testid");
    }
    // 纯锚点点击不该走我们的回调（jsdom 里只有 hash 跳转，不会触发"未实现导航"）
    fireEvent.click(screen.getByRole("link", { name: "锚" }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("docPath 缺失时解析不出来 → 不拦截（保持原样）", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer content={"[章程](章程.md)"} onNavigate={onNavigate} />);

    const a = screen.getByRole("link", { name: "章程" });
    // 没有我们的标记 = 走的还是原来的 MarkdownLink 分支（回调自然也不会被调用）
    expect(a).not.toHaveAttribute("data-testid");
    expect(decodeURIComponent(a.getAttribute("href") ?? "")).toBe("章程.md");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // 回归保护：这个 prop 是可选的，不传时必须和改动前**一模一样**
  it("未传 onNavigate：渲染结果与改动前一致（同样的 href/class/target，不拦点击）", () => {
    render(<MarkdownRenderer content={"[安全规范](./02-安全规范.md)"} docPath={DOC} />);

    const a = screen.getByRole("link", { name: "安全规范" });
    // href 原样透传（react-markdown 自己会做编码），我们只加行为、不改渲染
    expect(decodeURIComponent(a.getAttribute("href") ?? "")).toBe("./02-安全规范.md");
    expect(a).not.toHaveAttribute("data-testid");
    expect(a).not.toHaveAttribute("target");
    expect(a.className).toBe("text-sky-600 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-500 dark:text-sky-400");
  });

  it("拦截后的链接样式与非拦截一致（只有行为不同）", () => {
    const onNavigate = vi.fn();
    render(<MarkdownRenderer content={"[安全规范](./02-安全规范.md)"} docPath={DOC} onNavigate={onNavigate} />);

    expect(screen.getByRole("link", { name: "安全规范" }).className)
      .toBe("text-sky-600 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-500 dark:text-sky-400");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Markdown 排版守卫。
 *
 * 回归的原始缺陷：代码里到处写着 `prose prose-sm dark:prose-invert`，
 * 但 **从来没装过 @tailwindcss/typography**，也没有任何 `.prose` 样式定义 ——
 * 于是这些类全是空转的，所有 Markdown（学习库课时 / Wiki 文档 / 知识库预览）
 * 都在用浏览器默认样式渲染。表现就是"又挤又生硬"，而且**不报错、不失败**，
 * 只有肉眼看才发现的出来。
 *
 * 所以这里把"插件装了 + 在 CSS 里注册了 + 组件真的用了"钉成测试。
 */
const webRoot = join(__dirname, "..");

const read = (rel: string) => readFileSync(join(webRoot, rel), "utf8");

describe("Markdown 排版（prose）配置", () => {
  it("依赖里声明了 @tailwindcss/typography", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(Object.keys(all)).toContain("@tailwindcss/typography");
  });

  it("Tailwind 入口注册了该插件（Tailwind v4 用 @plugin）", () => {
    const css = read("app/globals.css");

    expect(css).toContain("@plugin \"@tailwindcss/typography\"");
  });

  it("Markdown 渲染器真的挂了 prose 类（否则装了也白装）", () => {
    const src = read("components/knowledge/MarkdownRenderer.tsx");

    expect(src).toMatch(/className="prose/);
    expect(src).toContain("dark:prose-invert");
  });

  it("去掉了 typography 默认给行内代码注入的反引号", () => {
    // 默认规则是 `.prose :where(code)::before/::after { content: "`" }`，
    // 页面上会真的显示出一对反引号。注意 `prose-code:before:content-none`
    // 那个工具类只生成了 `pre code` 的覆盖，管不到行内代码 —— 所以必须用显式选择器。
    const css = read("app/globals.css");

    expect(css).toContain(".prose code::before");
    expect(css).toContain(".prose code::after");
    expect(css).toMatch(/\.prose code::before[\s\S]*?content:\s*none/);
  });

  it("代码块不再套一层 <pre>（外层容器由 SyntaxHighlighter/MermaidBlock 自带）", () => {
    const src = read("components/knowledge/MarkdownRenderer.tsx");

    expect(src).toMatch(/pre:\s*\(\{\s*children\s*\}\)\s*=>\s*<>\{children\}<\/>/);
  });

  it("表格有显式样式 —— 学习文档大量用表格，默认样式最显挤", () => {
    const src = read("components/knowledge/MarkdownRenderer.tsx");

    expect(src).toContain("prose-th:bg-surface-subtle");
    expect(src).toContain("prose-table:border");
  });
});

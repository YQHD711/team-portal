"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { slugify } from "@/lib/studyNav";
import { isExternalUrl, docLinkHash, resolveDocLink } from "@/lib/markdownAssets";
import { wrapHighlights, highlightRenderers } from "@/lib/mdHighlight";
import { MarkdownImage } from "./MarkdownImage";
import { PROSE_CLASS } from "./proseClass";

// 性能 #9:mermaid(700KB+) + react-syntax-highlighter(200KB+ 各语言)均按需加载
const MermaidBlock = dynamic(() => import("./MermaidBlock"), {
  ssr: false,
  loading: () => <div className="mermaid my-4 text-sm text-muted">图表加载中...</div>,
});

/** 站内链接样式（锚点与可点击的文档引用共用，保证两种渲染结果看起来一致） */
const INTERNAL_LINK_CLASS = "text-sky-600 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-500 dark:text-sky-400";

interface MarkdownRendererProps {
  content: string;
  /** 当前文档在知识库里的相对路径 —— 用来把 `![](相对图.png)` 解析到知识库 */
  docPath?: string;
  /**
   * 站内相对 `.md` 链接的跳转回调（知识库/学习库传自己的"打开文档"逻辑）。
   * 第二个参数是链接里的 `#锚点`（已解码），调用方切完文档后滚过去。
   * **不传时行为与以前完全一致**：按普通链接渲染，不做任何拦截。
   */
  onNavigate?: (path: string, hash?: string) => void;
  /**
   * 搜索命中的关键词：在**渲染后的文本节点**上包 <mark data-testid="md-highlight">，
   * 不改 markdown 源文本（代码块/表格/mermaid 不受影响）。不传时渲染结果与以前完全一致。
   */
  highlight?: string;
  /**
   * 只渲染正文、不套 prose 容器（块级编辑用：整篇共用一个容器，避免每块各产生外边距）。
   * 不传时与以前完全一致。
   */
  bare?: boolean;
}

/** 取 React 子节点里的纯文本(标题生成锚点 id 用) */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

/**
 * 带 id 的标题 —— 右侧大纲(学习库课时页等)靠它做锚点跳转。
 * id 规则与 lib/studyNav.ts 的 slugify 必须一致，改一处要改两处。
 */
function heading(level: 1 | 2 | 3, hl: (c: ReactNode) => ReactNode) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={slugify(nodeText(children))} className="scroll-mt-24">{hl(children)}</Tag>;
  };
}

/** 外链统一标蓝 + 新窗口打开（站内锚点保持中性，免得整页都是蓝的） */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const url = href ?? "";
  if (isExternalUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="font-medium text-blue-600 underline decoration-blue-400/50 underline-offset-2 hover:text-blue-500 dark:text-blue-400">
        {children}
        <ExternalLink className="ml-0.5 inline h-3 w-3 align-[-1px]" aria-hidden />
      </a>
    );
  }
  return <a href={url} className={INTERNAL_LINK_CLASS}>{children}</a>;
}

export function MarkdownRenderer({ content, docPath, onNavigate, highlight, bare }: MarkdownRendererProps) {
  const [SyntaxHighlighter, setSyntaxHighlighter] = useState<any>(null);
  const [oneDark, setOneDark] = useState<any>(null);

  // 性能 #9:首次遇到非 mermaid 代码块才加载 syntax-highlighter(并入 React 懒挂载)
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    if (activated || !content.includes("```")) return;
    setActivated(true);
    (async () => {
      const [{ Prism }, styles] = await Promise.all([
        import("react-syntax-highlighter"),
        import("react-syntax-highlighter/dist/esm/styles/prism"),
      ]);
      setSyntaxHighlighter(() => Prism as any);
      setOneDark(styles.oneDark);
    })();
  }, [content, activated]);

  /**
   * 站内相对 `.md` 链接：拦下来走 onNavigate 切文档，而不是让浏览器真的导航走
   * （跳到 `/study/xxx.md` 只会 404）。解析不出来的（外链/锚点/图片附件/路由）
   * 一律原样交给 MarkdownLink —— 不传 onNavigate 时整条分支都不存在，行为与改动前一致。
   */
  const link = ({ href, children }: { href?: string; children?: ReactNode }) => {
    const target = onNavigate ? resolveDocLink(href, docPath) : null;
    if (!target) return <MarkdownLink href={href}>{children}</MarkdownLink>;
    return (
      <a href={href} data-testid="internal-doc-link" className={INTERNAL_LINK_CLASS}
        onClick={e => { e.preventDefault(); const hash = docLinkHash(href); if (hash) onNavigate?.(target, hash); else onNavigate?.(target); }}>
        {children}
      </a>
    );
  };

  // 不传 highlight 时是恒等函数：标题/段落渲染结果与改动前逐字一致
  const hl = (children: ReactNode) => (highlight ? wrapHighlights(children, highlight) : children);

  const body = (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading(1, hl),
          h2: heading(2, hl),
          h3: heading(3, hl),
          a: link,
          // 搜索命中高亮：只在传了 highlight 时覆盖正文元素，代码块/mermaid 不受影响
          ...(highlight ? highlightRenderers(highlight) : {}),
          img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} docPath={docPath} />,
          /**
           * 表格外面套一层可横向滚动的容器：宽表格以前会把整个阅读区撑破
           * （grid 项的 min-width:auto 让 1fr 无法收缩 → 整页出现横向滚动条）。
           * 外套不加边框，边框仍由 prose-table:border 提供，避免双层线。
           */
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg">
              <table className="!my-0" {...props}>{children}</table>
            </div>
          ),
          /** GFM 任务清单的复选框：默认是浏览器原生样式，跟正文对不齐也不好看 */
          input: (props) => (
            <input {...props} disabled className="mr-2 h-3.5 w-3.5 translate-y-[1px] accent-sky-500" />
          ),
          /**
           * 代码块不要再套一层 <pre>：里面已经由 SyntaxHighlighter(oneDark) /
           * MermaidBlock 自带容器了。两层叠起来会让背景与内边距加倍、对比度变差，
           * 连 mermaid 的报错框都会被关进那层深色底里。
           */
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const codeStr = String(children).replace(/\n$/, "");

            if (match && match[1] === "mermaid") {
              return <MermaidBlock code={codeStr} />;
            }

            if (!match) {
              return (
                <code className="rounded bg-surface-subtle px-1 py-0.5 text-sm" {...props}>
                  {children}
                </code>
              );
            }

            if (SyntaxHighlighter && oneDark) {
              return (
                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                  {codeStr}
                </SyntaxHighlighter>
              );
            }
            // 语法高亮 lib 还没加载完:先降级显示 pre 块
            return (
              <pre className="rounded bg-surface-subtle p-3 text-xs overflow-x-auto">
                <code>{codeStr}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
  );

  // bare：不套 prose 容器（块级编辑时整篇共用一个容器，避免每块各自产生外边距）
  if (bare) return body;
  return <div className={PROSE_CLASS}>{body}</div>;
}

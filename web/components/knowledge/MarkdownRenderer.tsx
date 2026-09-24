"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { slugify } from "@/lib/studyNav";

// 性能 #9:mermaid(700KB+) + react-syntax-highlighter(200KB+ 各语言)均按需加载
const MermaidBlock = dynamic(() => import("./MermaidBlock"), {
  ssr: false,
  loading: () => <div className="mermaid my-4 text-sm text-muted">图表加载中...</div>,
});

interface MarkdownRendererProps {
  content: string;
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
function heading(level: 1 | 2 | 3) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={slugify(nodeText(children))} className="scroll-mt-24">{children}</Tag>;
  };
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
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

  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none overflow-x-auto
      prose-headings:font-semibold
      prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-8 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-border
      prose-h3:text-base
      prose-table:text-sm prose-th:bg-surface-subtle prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-1.5
      prose-table:border prose-table:border-border prose-th:border prose-th:border-border prose-td:border prose-td:border-border
      prose-blockquote:border-l-4 prose-blockquote:border-sky-400/60 prose-blockquote:bg-sky-50/50 prose-blockquote:py-1 prose-blockquote:not-italic
      prose-li:my-1 prose-hr:my-8">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
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
    </div>
  );
}
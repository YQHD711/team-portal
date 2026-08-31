"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// 性能 #9:mermaid(700KB+) + react-syntax-highlighter(200KB+ 各语言)均按需加载
const MermaidBlock = dynamic(() => import("./MermaidBlock"), {
  ssr: false,
  loading: () => <div className="mermaid my-4 text-sm text-muted">图表加载中...</div>,
});

interface MarkdownRendererProps {
  content: string;
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
    <div className="prose prose-sm sm:prose-base prose-zinc dark:prose-invert max-w-none overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
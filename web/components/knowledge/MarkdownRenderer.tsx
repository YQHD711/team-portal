"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MarkdownRendererProps {
  content: string;
}

let mermaidSeq = 0;

// 每个 mermaid 块独立成子组件,渲染结果保存在 state 中,
// 避免直接改 DOM 后被 React 重渲染覆盖回原文
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${++mermaidSeq}`);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });
    mermaid
      .render(idRef.current, code)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <div className="mermaid my-4 text-sm text-danger p-3 border border-red-200 rounded-lg">
        图表渲染失败，请检查语法
      </div>
    );
  }

  if (svg === null) {
    return <div className="mermaid my-4">{code}</div>;
  }

  return <div className="mermaid my-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
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

            return (
              <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                {codeStr}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useEffect, useRef } from "react";
import mermaid from "mermaid";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const mermaidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mermaidRef.current) return;
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });

    const blocks = mermaidRef.current.querySelectorAll(".mermaid");
    blocks.forEach(async (block, i) => {
      if (block.getAttribute("data-processed")) return;
      const id = `mermaid-${Date.now()}-${i}`;
      const { svg } = await mermaid.render(id, block.textContent ?? "");
      block.innerHTML = svg;
      block.setAttribute("data-processed", "true");
    });
  }, [content]);

  return (
    <div ref={mermaidRef} className="prose prose-zinc dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const codeStr = String(children).replace(/\n$/, "");

            if (match && match[1] === "mermaid") {
              return <div className="mermaid my-4">{codeStr}</div>;
            }

            if (!match) {
              return (
                <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-sm" {...props}>
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

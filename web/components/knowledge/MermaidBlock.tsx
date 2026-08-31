"use client";

/** Mermaid 图表块 — 单独文件以配合 next/dynamic 懒加载。
 * 把 mermaid(压缩后 ~700KB+)从知识库/Wiki 首屏剥离,只在用户阅读含图表的文档时才加载。*/
import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  code: string;
}

let mermaidSeq = 0;

export default function MermaidBlock({ code }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${++mermaidSeq}`);

  useEffect(() => {
    let cancelled = false;
    let m: typeof import("mermaid").default | null = null;
    (async () => {
      try {
        m = (await import("mermaid")).default;
        m.initialize({ startOnLoad: false, theme: "neutral" });
        const { svg } = await m.render(idRef.current, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
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
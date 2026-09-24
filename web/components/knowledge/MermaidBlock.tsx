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
      <div className="mermaid my-4 rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/30 p-3 text-sm space-y-2">
        <div className="text-amber-700 dark:text-amber-300">图表渲染失败（Mermaid 语法有误），正文其余部分不受影响。</div>
        {/* 把源码折叠起来：读者不受干扰，维护的人能直接照着修 */}
        <details>
          <summary className="cursor-pointer select-none text-xs text-faint hover:text-amber-600">查看图表源码</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-surface-subtle p-2 text-xs text-muted">{code}</pre>
        </details>
      </div>
    );
  }

  if (svg === null) {
    return <div className="mermaid my-4">{code}</div>;
  }

  return <div className="mermaid my-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}
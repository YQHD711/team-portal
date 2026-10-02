/**
 * 搜索命中高亮（独立关注点）。
 *
 * 为什么不在 markdown 源文本上做替换：那样代码块/行内代码/表格里的命中会被当成正文
 * 重新解析（`**重点**` 会变成粗体、`#` 会变成标题），mermaid 与图片也会被污染。
 * 这里改成在**渲染后的 React 子节点**上切片：只把字符串子节点包成 <mark>，
 * 代码（<code>/<pre>）、图片、mermaid 这些自定义渲染组件一律原样不碰。
 */
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** 高亮标记的 testid / class：测试与样式都靠它 */
export const HIGHLIGHT_TESTID = "md-highlight";
export const HIGHLIGHT_CLASS = "rounded bg-yellow-200 px-0.5 dark:bg-yellow-500/40";

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** 切出高亮片段：大小写不敏感，命中词按**字面量**处理（不当年正则模式） */
export function splitHighlight(text: string, term: string): HighlightPart[] {
  const needle = term.trim();
  if (!needle || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const out: HighlightPart[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(target, from);
    if (at < 0) break;
    if (at > from) out.push({ text: text.slice(from, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (out.length === 0) return [{ text, hit: false }];
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}

/** 允许继续向内递归的内联元素：只有它们是"正文文本"，<code>/<img> 与自定义组件都跳过 */
const INLINE_WHITELIST = new Set(["a", "strong", "em", "b", "i", "u", "del", "s", "mark", "sub", "sup"]);

/**
 * 把 children 里的命中文本包成 <mark data-testid="md-highlight">。
 * term 为空时原样返回（调用方也据此保证"不传就不变"）。
 */
export function wrapHighlights(children: ReactNode, term: string, keyPrefix = "hl"): ReactNode {
  const needle = term.trim();
  if (!needle) return children;
  if (typeof children === "string") {
    const parts = splitHighlight(children, needle);
    if (parts.length === 1 && !parts[0].hit) return children;
    return parts.map((p, i) => (p.hit
      ? <mark key={`${keyPrefix}-${i}`} data-testid={HIGHLIGHT_TESTID} className={HIGHLIGHT_CLASS}>{p.text}</mark>
      : p.text));
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => wrapHighlights(child, needle, `${keyPrefix}-${i}`));
  }
  if (isValidElement(children) && typeof children.type === "string" && INLINE_WHITELIST.has(children.type)) {
    const el = children as ReactElement<{ children?: ReactNode }>;
    return cloneElement(el, { children: wrapHighlights(el.props.children, needle, `${keyPrefix}-c`) });
  }
  return children;
}

/**
 * 只覆盖「正文文本」元素（段落 / 列表项 / 表格单元格）：代码块与 mermaid 用的还是原渲染器，
 * 因此高亮不可能污染它们。MarkdownRenderer 只在传了 highlight 时才合并这份 map。
 */
export function highlightRenderers(term: string) {
  const make = (tag: "p" | "li" | "td" | "th") => function Highlighted(
    { children, ...props }: { children?: ReactNode } & React.HTMLAttributes<HTMLElement>
  ) {
    return createElement(tag, props, wrapHighlights(children, term));
  };
  return { p: make("p"), li: make("li"), td: make("td"), th: make("th") };
}

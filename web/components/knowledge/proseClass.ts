/**
 * 正文容器样式（整块渲染与「块级就地编辑」共用同一份）。
 *
 * 块级编辑把整篇按块分别渲染，但必须**共用一个 prose 容器**，
 * 否则每块各带一层 prose，块与块之间的间距会变样。
 */
export const PROSE_CLASS = `prose prose-zinc dark:prose-invert max-w-none overflow-x-auto
      prose-headings:font-semibold
      prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-8 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-border
      prose-h3:text-base
      prose-p:leading-7 prose-li:leading-7 prose-li:my-0.5
      prose-table:text-sm prose-th:bg-surface-subtle prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-1.5
      prose-table:border prose-table:border-border prose-th:border prose-th:border-border prose-td:border prose-td:border-border
      prose-blockquote:border-l-4 prose-blockquote:border-sky-400/60 prose-blockquote:bg-sky-50/50 prose-blockquote:py-1 prose-blockquote:not-italic
      prose-img:rounded-xl prose-img:border prose-img:border-border
      prose-hr:my-8`;

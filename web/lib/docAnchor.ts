/**
 * 文档内锚点定位（相对 `.md` 链接里的 `#小节`、搜索命中滚动都靠它）。
 * 纯 DOM 查找，不依赖 CSS.escape —— 中文 id 用属性比较更稳。
 */
import { slugify } from "./studyNav";

/** 解码锚点（URL/encodeURIComponent 会把中文编码成 %E5%B0%8F…） */
export function decodeAnchor(hash: string): string {
  let h = (hash ?? "").replace(/^#/, "");
  try { h = decodeURIComponent(h); } catch { /* 非法 % 序列就按原样用 */ }
  return h.trim();
}

/**
 * 在容器里按锚点找目标元素：
 * 1. 先按写法的原样 id 找；
 * 2. 找不到再按 slugify 后的 id 找（标题 id 由 MarkdownRenderer 用 slugify 生成，
 *    作者可能写的是「## 1. 小节 标题」对应的 `#1. 小节 标题`）。
 */
export function findAnchorTarget(container: ParentNode | null, hash: string): HTMLElement | null {
  if (!container) return null;
  const want = decodeAnchor(hash);
  if (!want) return null;
  const nodes = [...container.querySelectorAll<HTMLElement>("[id]")];
  const direct = nodes.find(n => n.id === want);
  if (direct) return direct;
  const slug = slugify(want);
  return slug ? nodes.find(n => n.id === slug) ?? null : null;
}

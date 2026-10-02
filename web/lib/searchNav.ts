/**
 * 搜索结果 → 跳转地址。
 *
 * 后端 `KnowledgeTarget()`（SearchEndpoints.cs:147）对学习库结果给两种 path：
 * - 课时：`/study?lesson=<知识库路径>`（已带参数）
 * - 说明类（`_学习路径.md` / `_阶段说明.md`）：**`/study`**（正文由总览页展示，没有任何参数）
 * 两种都不带搜索词，所以学习库结果要由前端**追加** `q=` —— `/study` 页据此高亮命中 + 滚到命中处。
 * 注意是追加而不是重建：`/study?lesson=X` 必须保留 `lesson`，否则用户会掉回学习库主页。
 */
export function searchTargetUrl(path: string, term: string): string {
  const t = term.trim();
  if (!t || !/^\/study(\?|$)/.test(path)) return path;
  if (/[?&]q=/.test(path)) return path; // 已经有 q 就别重复追加
  return `${path}${path.includes("?") ? "&" : "?"}q=${encodeURIComponent(t)}`;
}

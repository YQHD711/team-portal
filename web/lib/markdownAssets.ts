/**
 * Markdown 里的图片/链接处理（纯函数，便于单测）。
 *
 * 背景：知识库文档里的图片写的是**相对路径**（`![](示意图.png)`），
 * 而浏览器会把相对路径按当前**页面 URL** 解析（→ `/study/示意图.png`，404）。
 * 同时 `/api/knowledge/download` 需要 JWT，`<img src>` 发不出 Authorization 头，
 * 所以图片必须"解析成知识库路径 → 带鉴权取回 blob"两步走。
 */

/** 外链：带协议、协议相对、邮件/电话。 */
export function isExternalUrl(url: string): boolean {
  return /^(https?:)?\/\//i.test(url) || /^(mailto|tel):/i.test(url);
}

/** 不需要走知识库解析的地址（外链 / data: / blob:）。 */
export function isRemoteAsset(url: string): boolean {
  return isExternalUrl(url) || /^(data|blob):/i.test(url);
}

/**
 * 把文档里的相对图片地址解析成**知识库相对路径**。
 * - `示意图.png` / `./a/x.png` → 以文档所在目录为基准
 * - `../公共/图.png` → 允许往上一级（越界则返回 null）
 * - `/公共/图.png` → 视为知识库根开始的绝对路径
 * - `#锚点`、空串 → null
 */
export function resolveAssetPath(src: string | undefined, docPath?: string): string | null {
  let raw = (src ?? "").trim();
  if (!raw || raw.startsWith("#")) return null;
  // 去掉 ?query / #hash 后再解析；作者可能写成 ![](a.png "标题") → 由 react-markdown 处理，这里只处理 src
  raw = raw.split(/[?#]/)[0];
  if (!raw) return null;
  try { raw = decodeURIComponent(raw); } catch { /* 含非法 % 序列就按原样用 */ }

  if (raw.startsWith("/")) return normalize(raw.replace(/^\/+/, ""));

  const dir = (docPath ?? "").replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  return normalize(dir ? `${dir}/${raw}` : raw);
}

/** 规范化 `a/b/../c` → `a/c`；越出根返回 null。 */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length > 0 ? out.join("/") : null;
}

/** 带鉴权的知识库资源地址（用 api.download 取 blob 时用）。 */
export function knowledgeAssetUrl(path: string): string {
  return `/api/knowledge/download?path=${encodeURIComponent(path)}`;
}

/** 图片地址像不像"文件名"（`01-示意图.png`）——像的话就不拿它当图注显示。 */
export function looksLikeFileName(alt: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(alt.trim());
}

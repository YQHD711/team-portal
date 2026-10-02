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

/**
 * 把文档里的**相对 .md 链接**解析成站内文档路径（相对当前文档所在目录）。
 * 返回 null = 不拦截、按普通链接放行，交给浏览器/React 原样处理：
 * - 外链 `http(s)://`、协议相对 `//`、`mailto:` / `tel:` / 其它协议
 * - 纯锚点 `#xxx`
 * - 非 `.md`（图片、pdf 附件…）
 * - 以 `/` 开头的站内路由（`/inventory/layout` 这类 Next 路由不能拦）
 * - 当前文档路径缺失，或 `../` 上跳越出知识库根
 * `#锚点` 不参与路径解析：需要锚点时另外用 `docLinkHash` 取，切完文档再滚过去。
 */
export function resolveDocLink(href: string | undefined, docPath?: string): string | null {
  const raw = (href ?? "").trim();
  if (!raw || !docPath) return null;
  if (raw.startsWith("#")) return null;
  if (isExternalUrl(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;

  // 去掉 ?query / #hash；反斜杠按路径分隔符处理（有人从 Windows 里复制路径）
  let file = raw.split("#")[0].split("?")[0].trim().replace(/\\/g, "/");
  if (!/\.md$/i.test(file)) return null;
  // react-markdown 会把 href 做 URL 编码（中文路径会变成 %E7%AB%A0...），先解回真实文件名
  try { file = decodeURIComponent(file); } catch { /* 含非法 % 序列就按原样用 */ }

  const dir = docPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  return normalize(dir ? `${dir}/${file}` : file);
}

/**
 * 取出站内文档链接里的 `#锚点`（已解码，没写锚点返回 null）。
 * 只在 `resolveDocLink` 判定为站内文档链接后才该调用 —— 外链的 fragment 不算文档锚点。
 */
export function docLinkHash(href: string | undefined): string | null {
  const raw = (href ?? "").trim();
  const at = raw.indexOf("#");
  if (at < 0) return null;
  let hash = raw.slice(at + 1);
  try { hash = decodeURIComponent(hash); } catch { /* 非法 % 序列就按原样用 */ }
  return hash.trim() || null;
}

/** 带鉴权的知识库资源地址（用 api.download 取 blob 时用）。 */
export function knowledgeAssetUrl(path: string): string {
  return `/api/knowledge/download?path=${encodeURIComponent(path)}`;
}

/** 图片地址像不像"文件名"（`01-示意图.png`）——像的话就不拿它当图注显示。 */
export function looksLikeFileName(alt: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(alt.trim());
}

/** 浏览器另存 Blob。download 属性只对同源 URL 生效，故先转成 blob: URL。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 从知识库路径取文件名（末段）：`公共/x/DS-009 ....pdf` → `DS-009 ....pdf` */
export function filenameFromPath(path: string): string {
  const name = path.split("/").filter(Boolean).pop();
  return name && name.trim() ? name : "download";
}

/**
 * 客户端默认文件名 `{prefix}-YYYYMMDD.{ext}`。
 * 鉴权下载走 fetch（`api.download` 只回 Blob），拿不到后端 Content-Disposition，
 * 所以导出类下载用这个与后端一致的命名规则。
 */
export function datedFilename(prefix: string, ext = "csv", now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.${ext}`;
}

/**
 * 下载失败 → 给用户看的提示文案；**401 返回 null**：
 * api.download 已经清 token 并跳 /auth/login，页面不该再弹「下载失败」误导人。
 */
export function downloadErrorMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("登录已过期")) return null;
  return msg || "下载失败";
}

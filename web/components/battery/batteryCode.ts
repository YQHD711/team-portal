/**
 * 从身份码内容取用户标识：支持完整短链 /u/{slug}、纯 slug、纯学号/用户名。
 * 与 extractBatteryCode 对称——身份码标识「人」，电池码标识「物」。
 */
export function extractUserIdentity(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p === "u");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  } catch {
    // 不是 URL，按纯标识处理
  }
  return trimmed;
}

/** 从扫码内容里取电池编码：支持纯编码、短链 /b/<code> 或 /i/<code>。 */
export function extractBatteryCode(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p === "b" || p === "i");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  } catch {
    // 不是 URL，按纯编码处理
  }
  return trimmed;
}

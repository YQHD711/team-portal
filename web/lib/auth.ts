/** Auth helpers — token storage and user state. */

const TOKEN_KEY = "token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/** Decode role from JWT payload (server-signed, not tamperable client-side). */
function decodeRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    // JWT payload 是 base64url(含 - / _)且常无填充,而 atob 只认标准 base64;
    // 不归一化直接 atob 会抛 InvalidCharacterError → role 解析为 null → 部长度访问 /admin 被弹回仪表盘。
    const b64 = token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    // atob 返回 Latin-1 字节串,直接 JSON.parse 会把中文(如角色"部长")解码成乱码;
    // 需按 UTF-8 还原。两处一起处理角色才能正确比较。
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] ?? null;
  } catch {
    return null;
  }
}

export function getUserRole(): string | null {
  return decodeRole();
}

export function isAdmin(): boolean {
  return decodeRole() === "admin";
}

export function isStaff(): boolean {
  const role = decodeRole();
  return role === "admin" || role === "部长";
}

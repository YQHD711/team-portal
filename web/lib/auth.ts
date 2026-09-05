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
    // atob 返回的是 Latin-1 字节串,直接 JSON.parse 会把中文(如角色"部长")解码成乱码,
    // 导致 isStaff()/isAdmin() 误判 → 部长度访问 /admin 被 AuthGuard 弹回仪表盘。
    const bytes = Uint8Array.from(atob(token.split(".")[1]), c => c.charCodeAt(0));
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

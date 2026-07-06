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
    const payload = JSON.parse(atob(token.split(".")[1]));
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

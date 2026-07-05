/** Auth helpers — token storage and user state. */

const TOKEN_KEY = "token";
const ROLE_KEY = "role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function getUserRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY);
}

export function setUserRole(role: string): void {
  localStorage.setItem(ROLE_KEY, role);
}

export function isAdmin(): boolean {
  const role = getUserRole();
  return role === "admin";
}

export function isStaff(): boolean {
  const role = getUserRole();
  return role === "admin" || role === "部长";
}

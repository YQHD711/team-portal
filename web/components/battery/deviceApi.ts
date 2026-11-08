/**
 * 设备终端 API 封装：设备凭据（X-Device-Key/Secret）+ 设备内用户会话（X-Device-Session）。
 * 与网页用户 JWT 完全分离 —— 设备页不需要用户登录系统，只在设备上登录使用人。
 */

import { API_BASE, isBrowser } from "@/lib/api-base";

export interface DeviceUser {
  id: number;
  username: string;
  role: string;
}

export interface DeviceLoginResult {
  sessionToken: string;
  expiresAt: string;
  user: DeviceUser;
}

export interface DeviceBattery {
  id: number;
  code: string;
  model: string | null;
  status: string;
  health: string | null;
  borrower: string | null;
  borrowedAt: string | null;
}

const K_KEY = "battery-device-key";
const K_SECRET = "battery-device-secret";
const K_SESSION = "battery-device-session";
const K_USER = "battery-device-user";

export interface DeviceConfig {
  key: string;
  secret: string;
}

export function getDeviceConfig(): DeviceConfig | null {
  if (!isBrowser()) return null;
  const key = localStorage.getItem(K_KEY);
  const secret = localStorage.getItem(K_SECRET);
  return key && secret ? { key, secret } : null;
}

export function saveDeviceConfig(key: string, secret: string): void {
  localStorage.setItem(K_KEY, key.trim());
  localStorage.setItem(K_SECRET, secret.trim());
}

export function clearDeviceConfig(): void {
  localStorage.removeItem(K_KEY);
  localStorage.removeItem(K_SECRET);
  clearDeviceSession();
}

export function getDeviceSession(): { token: string | null; user: DeviceUser | null } {
  if (!isBrowser()) return { token: null, user: null };
  const token = localStorage.getItem(K_SESSION);
  const raw = localStorage.getItem(K_USER);
  let user: DeviceUser | null = null;
  try { user = raw ? (JSON.parse(raw) as DeviceUser) : null; } catch { user = null; }
  return { token, user };
}

export function clearDeviceSession(): void {
  localStorage.removeItem(K_SESSION);
  localStorage.removeItem(K_USER);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = getDeviceConfig();
  const session = getDeviceSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg) {
    headers["X-Device-Key"] = cfg.key;
    headers["X-Device-Secret"] = cfg.secret;
  }
  if (session.token) headers["X-Device-Session"] = session.token;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as Record<string, unknown>));
    const detail = typeof err.detail === "string" ? err.detail : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function deviceLogin(username: string, password: string): Promise<DeviceLoginResult> {
  const result = await request<DeviceLoginResult>("/api/device/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem(K_SESSION, result.sessionToken);
  localStorage.setItem(K_USER, JSON.stringify(result.user));
  return result;
}

export async function deviceLogout(): Promise<void> {
  try {
    await request("/api/device/logout", { method: "POST", body: "{}" });
  } finally {
    clearDeviceSession();
  }
}

export function deviceGetBattery(code: string): Promise<DeviceBattery> {
  return request<DeviceBattery>(`/api/device/battery/${encodeURIComponent(code)}`);
}

export function deviceBorrow(code: string): Promise<{ loanId: number; code: string }> {
  return request(`/api/device/battery/${encodeURIComponent(code)}/borrow`, { method: "POST", body: "{}" });
}

export function deviceReturn(code: string): Promise<{ loanId: number; code: string }> {
  return request(`/api/device/battery/${encodeURIComponent(code)}/return`, { method: "POST", body: "{}" });
}

export function deviceMine(): Promise<Array<{ id: number; code: string; borrowedAt: string }>> {
  return request("/api/device/battery/mine");
}

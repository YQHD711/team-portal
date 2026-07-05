/** API client for Team Portal backend. All HTTP requests go through here. */

const API_BASE = ""; // Relative URL — proxied through Next.js rewrites
const REQUEST_TIMEOUT = 30000; // 30 seconds

function isBrowser() {
  return typeof window !== "undefined";
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = isBrowser() ? localStorage.getItem("token") : null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Auto-redirect on 401
    if (res.status === 401 && isBrowser()) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      window.location.href = "/auth/login";
      throw new Error("登录已过期，请重新登录");
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({
        detail: `请求失败 (${res.status})`,
      }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接");
    }
    throw err;
  }
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
};

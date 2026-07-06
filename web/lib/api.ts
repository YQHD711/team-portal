/** API client for Team Portal backend. All HTTP requests go through here. */

const API_BASE = ""; // Relative URL — proxied through Next.js rewrites
const DEFAULT_TIMEOUT = 30000; // 30 seconds

function isBrowser() {
  return typeof window !== "undefined";
}

type RequestOptions = RequestInit & {
  /** Override request timeout in milliseconds */
  timeoutMs?: number;
};

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT, ...fetchOptions } = options;
  const token = isBrowser() ? localStorage.getItem("token") : null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...fetchOptions.headers,
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Auto-redirect on 401
    if (res.status === 401 && isBrowser()) {
      localStorage.removeItem("token");
      window.location.href = "/auth/login";
      throw new Error("登录已过期，请重新登录");
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({
        detail: `请求失败 (${res.status})`,
      }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : ({} as T);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接");
    }
    throw err;
  }
}

export const api = {
  get: <T>(endpoint: string, timeoutMs?: number) =>
    request<T>(endpoint, { timeoutMs }),
  post: <T>(endpoint: string, body: unknown, timeoutMs?: number) =>
    request<T>(endpoint, { method: "POST", body: JSON.stringify(body), timeoutMs }),
  put: <T>(endpoint: string, body: unknown, timeoutMs?: number) =>
    request<T>(endpoint, { method: "PUT", body: JSON.stringify(body), timeoutMs }),
  delete: <T>(endpoint: string, timeoutMs?: number) =>
    request<T>(endpoint, { method: "DELETE", timeoutMs }),
};

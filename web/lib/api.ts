/** API client for Team Portal backend. All HTTP requests go through here. */

const API_BASE = ""; // Relative URL — proxied through Next.js rewrites
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const UPLOAD_TIMEOUT = 1800000; // 30 minutes — 大文件上传(最高1GB)+ Next.js rewrites 转发

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

  const isFormData = fetchOptions.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
    request<T>(endpoint, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
      // multipart 上传默认给 3 分钟,避免大文件超过 30s 默认超时
      timeoutMs: timeoutMs ?? (body instanceof FormData ? UPLOAD_TIMEOUT : DEFAULT_TIMEOUT),
    }),
  put: <T>(endpoint: string, body: unknown, timeoutMs?: number) =>
    request<T>(endpoint, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body),
      timeoutMs: timeoutMs ?? (body instanceof FormData ? UPLOAD_TIMEOUT : DEFAULT_TIMEOUT),
    }),
  delete: <T>(endpoint: string, timeoutMs?: number) =>
    request<T>(endpoint, { method: "DELETE", timeoutMs }),
  /** SSE/流式请求：返回原生 Response，由调用方解析流（保留超时、401 重定向、错误处理） */
  stream: async (endpoint: string, body: unknown, timeoutMs?: number): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT);
    const token = isBrowser() ? localStorage.getItem("token") : null;
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 401 && isBrowser()) {
        localStorage.removeItem("token");
        window.location.href = "/auth/login";
        throw new Error("登录已过期，请重新登录");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("请求超时，请检查网络连接");
      }
      throw err;
    }
  },
};

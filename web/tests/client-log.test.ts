import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installClientErrorLogging, stopClientErrorLogging } from "@/lib/clientLog";

/** 模拟 window 'error'（脚本异常的标准路径：message/filename/lineno/colno 都在 event 上） */
function fireError(
  message: string,
  extra: { error?: Error; filename?: string; lineno?: number; colno?: number } = {},
) {
  window.dispatchEvent(new ErrorEvent("error", {
    message,
    error: extra.error,
    filename: extra.filename ?? "",
    lineno: extra.lineno ?? 0,
    colno: extra.colno ?? 0,
  }));
}

/** jsdom 没有 PromiseRejectionEvent 构造器，用普通 Event + reason 属性模拟 */
function fireRejection(reason: unknown) {
  const event = new Event("unhandledrejection") as PromiseRejectionEvent;
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

let fetchMock: ReturnType<typeof vi.fn>;

function calls(): FetchCall[] {
  return fetchMock.mock.calls.map((c) => ({ url: c[0] as string, init: c[1] as RequestInit }));
}

function bodyOf(index = 0): { level: string; message: string; stack?: string; url?: string } {
  return JSON.parse(String(calls()[index].init.body)) as {
    level: string;
    message: string;
    stack?: string;
    url?: string;
  };
}

beforeEach(() => {
  stopClientErrorLogging();
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchMock);
  installClientErrorLogging();
});

afterEach(() => {
  stopClientErrorLogging();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("客户端错误上报", () => {
  it("window 'error' → POST /api/client-logs，JSON + keepalive，不读响应体", () => {
    fireError("boom", { error: new Error("boom"), filename: "/_next/static/app.js", lineno: 12, colno: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [{ url, init }] = calls();
    expect(url).toBe("/api/client-logs");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = bodyOf();
    expect(body.level).toBe("error");
    // 后端 DTO 没有 type/source/line/column，约定是拼进 message
    expect(body.message).toBe("[error] boom @ /_next/static/app.js:12:5");
    expect(body.url).toContain("http");
    expect(body.stack).toContain("boom");
  });

  it("unhandledrejection 的 reason 会被转成 message（字符串/Error 都支持）", () => {
    fireRejection("kaboom");
    fireRejection(new TypeError("x is undefined"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0).message).toBe("[unhandledrejection] kaboom");
    expect(bodyOf(1).message).toBe("[unhandledrejection] x is undefined");
  });

  it("同一条 message 只上报一次（每会话去重）", () => {
    fireError("重复的错误");
    fireError("重复的错误");
    fireError("重复的错误");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("每会话最多 10 条（第 11 条起丢弃）", () => {
    for (let i = 1; i <= 12; i += 1) fireError("错误 " + i);

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(bodyOf(9).message).toBe("[error] 错误 10");
  });

  it("忽略 AbortError / ResizeObserver / 断网噪声", () => {
    const abort = new Error("The user aborted a request.");
    abort.name = "AbortError";
    fireRejection(abort);
    fireError("ResizeObserver loop limit exceeded");
    fireError("Failed to fetch");
    fireError("Load failed");
    fireError("NetworkError when attempting to fetch resource.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("install 幂等：重复安装不会重复上报", () => {
    installClientErrorLogging();
    installClientErrorLogging();
    fireError("只该报一次");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stop 后不再监听", () => {
    stopClientErrorLogging();
    fireError("停止后的错误");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上报失败（fetch reject / 同步抛错）不抛出、不影响页面", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("network down")));
    expect(() => fireError("网络失败时的错误")).not.toThrow();
    await Promise.resolve();

    fetchMock.mockImplementationOnce(() => {
      throw new Error("sync fetch failure");
    });
    expect(() => fireError("同步失败的错误")).not.toThrow();
  });

  it("204 无响应体是成功，客户端不读 body", () => {
    const res = new Response(null, { status: 204 });
    fetchMock.mockResolvedValueOnce(res);
    const jsonSpy = vi.spyOn(res, "json");
    const textSpy = vi.spyOn(res, "text");

    fireError("204 场景");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();
  });
});

/**
 * 客户端运行时错误上报：window 'error' / 'unhandledrejection' → POST /api/client-logs。
 *
 * 为什么需要它：后端请求日志只看得见“哪个接口失败了”，看不见浏览器里炸掉的渲染、
 * 加载失败的 chunk、用户手机上抛出的未捕获异常。HTTPS 上线后同一页面会被多终端访问，
 * 这类错误只能由客户端主动回传，否则线上问题永远只有一句“页面白屏了”。
 *
 * 设计约束（每条都是为了不让“上报”本身制造新问题）：
 *  - 永不抛异常、永不 await：上报失败不能变成第二个错误，也不能产生 unhandledrejection。
 *  - 采样：每会话最多 MAX_REPORTS 条，同一条 message 只报一次（Set）。
 *  - 过滤噪声：AbortError（组件卸载/请求取消）、ResizeObserver loop（布局抖动）、
 *    网络中断（断网时每个请求都会失败）都不值得进日志。
 *  - fetch keepalive：页面正在卸载/刷新时错误照样发得出去。
 *  - 裸 fetch 而不是 lib/api.ts：api 遇 401 会自动跳登录页，错误上报绝不能触发跳转。
 *  - 后端契约（src/TeamPortal/Endpoints/ClientLogEndpoints.cs）：JSON body 只认
 *    { level?, message, stack?, url? }，成功是 204 且无响应体，客户端不读 body。
 */

const ENDPOINT = "/api/client-logs";
/** 每会话最多上报条数（SPA 内一次加载算一个会话） */
const MAX_REPORTS = 10;
const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_URL = 500;

export type ClientLogLevel = "info" | "warn" | "error";

/** 后端实际接收的 JSON 形状；契约外的字段服务端会忽略，所以这里只发已约定的 */
interface ClientLogPayload {
  level: ClientLogLevel;
  message: string;
  stack?: string;
  url?: string;
}

interface ReportInput {
  type: "error" | "unhandledrejection";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
}

let installed = false;
let reportCount = 0;
const seenMessages = new Set<string>();
let onError: ((event: ErrorEvent) => void) | null = null;
let onRejection: ((event: PromiseRejectionEvent) => void) | null = null;

/** 这些错误不是 bug，是浏览器/框架的正常噪声，全部跳过 */
function isNoise(message: string): boolean {
  const noise = [
    /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i,
    /AbortError/i, // 组件卸载/请求取消：fetch/play() 被 abort 时的标准名字
    /The operation was aborted/i,
    /Failed to fetch/i, // Chrome 断网
    /Load failed/i, // Safari 断网
    /NetworkError when attempting to fetch resource/i,
    /Network request failed/i, // 部分 WebView
    /net::ERR_(?:NETWORK|CONNECTION|NAME|INTERNET|TIMED_OUT)/i,
    /\brequest (?:was )?cancell?ed\b/i,
    /Extension context invalidated/i, // 浏览器插件失效
  ];
  return noise.some(re => re.test(message));
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** 把任意 rejection reason 变成可读 message/stack，绝不抛异常 */
function describeReason(reason: unknown): { message: string; stack?: string } {
  try {
    if (reason instanceof Error) {
      return { message: reason.message || reason.name || "Error", stack: reason.stack };
    }
    if (typeof reason === "string") return { message: reason };
    if (reason && typeof reason === "object") {
      const asRecord = reason as { message?: unknown };
      if (typeof asRecord.message === "string" && asRecord.message) {
        return { message: asRecord.message };
      }
      return { message: JSON.stringify(reason) };
    }
    return { message: String(reason) };
  } catch {
    return { message: "unknown rejection reason" };
  }
}

/** 裸 fetch 发送；同步/异步失败一律吞掉，且不把 Promise 暴露给外部 await */
function post(payload: ClientLogPayload): void {
  try {
    const result = fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "same-origin",
    });
    // 204 是成功；这里刻意不读响应体。失败（断网/后端 5xx）静默丢弃。
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    /* fetch 同步抛错（极少见）也不能影响页面 */
  }
}

/** 采样 + 去重 + 组装契约字段，最后交给 post */
function report(input: ReportInput): void {
  try {
    if (typeof window === "undefined") return;
    const rawMessage = (input.message ?? "").trim();
    if (!rawMessage || isNoise(rawMessage)) return;
    if (seenMessages.has(rawMessage) || reportCount >= MAX_REPORTS) return;

    seenMessages.add(rawMessage);
    reportCount += 1;

    // 后端 DTO 没有 type/source/line/column 字段，按约定拼进 message，信息不丢。
    const linePart = typeof input.line === "number" ? `:${input.line}` : "";
    const columnPart = typeof input.column === "number" ? `:${input.column}` : "";
    const location = input.source ? ` @ ${input.source}${linePart}${columnPart}` : "";
    const message = truncate(`[${input.type}] ${rawMessage}${location}`, MAX_MESSAGE);

    post({
      level: "error",
      message,
      stack: input.stack ? truncate(input.stack, MAX_STACK) : undefined,
      url: window.location ? truncate(window.location.href, MAX_URL) : undefined,
    });
  } catch {
    /* 上报永远不能抛 */
  }
}

function handleError(event: ErrorEvent): void {
  // 资源加载失败（<img>/<script> onerror）也会触发 window 'error'，但那是普通 Event
  // 而不是 ErrorEvent，且没有 message。这类不是 JS 异常，跳过，免得每条失败的图片
  // 都变成一条日志。（不要用 event.target === window 判断：部分运行环境里 target 是
  // 内层 window 对象，与全局 window 代理不相等，会把真正的异常一起丢掉。）
  if (!(event instanceof ErrorEvent)) return;
  const described = describeReason(event.error as unknown);
  report({
    type: "error",
    message: event.message || described.message,
    stack: described.stack,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
}

function handleRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  // AbortError 的 message 是 “The user aborted a request.”，不含名字；必须按 name 判，
  // 否则组件卸载时每个被取消的 fetch 都会上报一条。
  if (reason instanceof Error && reason.name === "AbortError") return;
  const described = describeReason(reason);
  report({ type: "unhandledrejection", message: described.message, stack: described.stack });
}

/**
 * 安装全局监听。
 * 幂等：重复调用（React StrictMode 双执行、多次 mount）不会重复注册监听器。
 * stop 会移除监听并清空采样状态，便于测试与热更新。
 */
export function installClientErrorLogging(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  onError = handleError;
  onRejection = handleRejection;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
}

export function stopClientErrorLogging(): void {
  if (typeof window !== "undefined" && installed) {
    if (onError) window.removeEventListener("error", onError);
    if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
  }
  onError = null;
  onRejection = null;
  installed = false;
  reportCount = 0;
  seenMessages.clear();
}

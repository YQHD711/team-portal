/**
 * AI 流式响应的统一消费层。
 *
 * 背景：以前每个聊天组件各自手写 `reader.read()` + `if (line.startsWith("data: "))`，
 * 结果三件事都没做对：
 * ① 后端返回的 503/429 被一律显示成「AI 服务暂不可用」，用户不知道是限流、未配置还是超时；
 * ② 没有任何超时保护，上游挂起时界面永远转圈；
 * ③ 不认识后端的 `event: error` 错误帧，流中途失败时用户只看到半截回答、没有任何提示。
 *
 * 这里把「HTTP 状态 → 用户可读提示」「流内错误帧」「空闲超时」集中处理，
 * 两个聊天组件（ChatPanel / FloatingChat）共用。
 */

export type AiStreamErrorKind =
  | "auth"
  | "rate"
  | "unavailable"
  | "timeout"
  | "network"
  | "aborted"
  | "server";

/** 带语义分类的 AI 错误，UI 可以按 kind 决定是提示重试还是引导重新登录 */
export class AiStreamError extends Error {
  readonly kind: AiStreamErrorKind;

  constructor(kind: AiStreamErrorKind, message: string) {
    super(message);
    this.name = "AiStreamError";
    this.kind = kind;
  }
}

function statusToKind(status: number): AiStreamErrorKind {
  if (status === 401) return "auth";
  if (status === 429) return "rate";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  return "server";
}

/** HTTP 状态码 → 用户能看懂的一句话（不是给开发看的堆栈） */
export function httpErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "问题内容不合法，请修改后重试";
    case 401:
      return "登录已过期，请重新登录";
    case 403:
      return "没有使用 AI 助手的权限";
    case 429:
      return "请求过于频繁，请等几秒再试";
    case 502:
      return "AI 服务暂时不可用，请稍后重试";
    case 503:
      return "AI 服务暂不可用（可能未配置密钥或上游超时），请稍后重试";
    case 504:
      return "AI 服务响应超时，请稍后重试";
    default:
      return `AI 服务出错（HTTP ${status}），请稍后重试`;
  }
}

/** 任意异常 → 带分类、可直接展示的错误 */
export function toAiStreamError(err: unknown): AiStreamError {
  if (err instanceof AiStreamError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new AiStreamError("aborted", "已取消本次回答");
  }
  if (err instanceof TypeError) {
    return new AiStreamError("network", "网络连接失败，请检查网络后重试");
  }
  // api.stream 抛的 HTTP 错误带 status，这里还原成可读文案（否则只剩 "HTTP 503"）
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    return new AiStreamError(statusToKind(status), httpErrorMessage(status));
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new AiStreamError("server", msg.trim() || "AI 服务出错，请稍后重试");
}

export interface AiStreamCallbacks {
  /** 每收到一段正文增量 */
  onDelta: (chunk: string) => void;
  /** 已收到响应头（首字节），用于把「正在检索资料」切换成「正在输出」 */
  onFirstByte?: () => void;
  /** 后端发来的 event: error 帧 */
  onStreamError?: (message: string) => void;
  /** 空闲超时：这么久没收到任何数据就判定超时（默认 120 秒，覆盖工具检索轮） */
  idleTimeoutMs?: number;
}

/** 从 SSE 的 data 行里取 delta.content；不认识的结构返回空串 */
function extractDelta(data: string): string {
  if (data === "[DONE]") return "";
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return "";
    const choices = (parsed as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return "";
    const first = choices[0] as { delta?: { content?: unknown } } | undefined;
    const content = first?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/**
 * 消费 `/api/ai/chat` 的 SSE 响应，返回完整正文。
 *
 * - 每块转发立刻回调 `onDelta`（流式渲染）
 * - 空闲超过 `idleTimeoutMs` 主动中断并抛 `timeout` 错误（不让界面永远转圈）
 * - 后端 `event: error` 帧会被识别并抛出，不会静默吞掉
 */
export async function consumeAiStream(
  res: Response,
  cb: AiStreamCallbacks,
): Promise<string> {
  if (!res.ok) {
    throw new AiStreamError(statusToKind(res.status), httpErrorMessage(res.status));
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new AiStreamError("server", "AI 返回了空响应，请重试");
  }
  cb.onFirstByte?.();

  const decoder = new TextDecoder();
  const idleMs = cb.idleTimeoutMs ?? 120_000;
  let buffer = "";
  let eventName = "";
  let full = "";

  /** 单次读取 + 空闲超时守卫（每次读都重新计时，收到数据就重置） */
  const readWithIdleGuard = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void reader.cancel().catch(() => {});
            reject(
              new AiStreamError(
                "timeout",
                `AI 超过 ${Math.round(idleMs / 1000)} 秒没有返回内容，请重试`,
              ),
            );
          }, idleMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      const { done, value } = await readWithIdleGuard();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        // SSE 用空行分隔事件；事件名对它后面紧跟的 data 行生效
        if (line === "") {
          eventName = "";
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trimStart();
        if (eventName === "error") {
          let message = "AI 响应中断，请重试";
          try {
            const parsed: unknown = JSON.parse(data);
            const err = (parsed as { error?: unknown }).error;
            if (typeof err === "string" && err.trim()) message = err;
          } catch {
            // 后端也可能直接发纯文本
            if (data.trim()) message = data.trim();
          }
          cb.onStreamError?.(message);
          throw new AiStreamError("server", message);
        }

        const delta = extractDelta(data);
        if (delta) {
          full += delta;
          cb.onDelta(delta);
        }
      }
    }
    return full;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 流已结束/已取消，忽略
    }
  }
}

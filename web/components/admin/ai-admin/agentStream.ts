import type { MemoryStats } from "./aiAdminTypes";

/**
 * AI 管理员的 SSE 增量解析（task-13）：与主聊天一样是手写 parser ——
 * 后端会把 provider 的 `data: {...}` 原样转发，同时夹带自己的 `event: status/done/error`。
 * 这里只做纯函数解析，React 状态更新留给页面，便于 vitest 单测。
 */

export interface AgentSseEvent {
  /** 事件名；provider 原生分片没有 event 行，按 SSE 默认的 message 处理 */
  event: string;
  data: string;
}

/** 解析单个 SSE 帧（空行分隔的一段），data 行可能多行。 */
export function parseAgentSseFrame(frame: string): AgentSseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/** 增量解析器：喂 TextDecoder 解出的字符串片段，按空行切帧回调。 */
export function createAgentSseParser(onEvent: (evt: AgentSseEvent) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evt = parseAgentSseFrame(frame);
      if (evt) onEvent(evt);
    }
  };
}

/** provider 原生分片：只取 choices[0].delta.content；[DONE] 与坏 JSON 返回空串。 */
export function parseProviderDelta(data: string): string {
  if (data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

export interface AgentStreamUpdate {
  /** status 事件：进度文案（第 N 轮 / 调用了什么工具 / 正在生成回答） */
  status?: string;
  /** provider 分片：回答增量 */
  delta?: string;
  /** done 事件：刷新记忆统计 */
  stats?: MemoryStats;
  /** error 事件：可读错误文案 */
  error?: string;
}

export function interpretAgentEvent(evt: AgentSseEvent): AgentStreamUpdate {
  let payload: unknown;
  try {
    payload = JSON.parse(evt.data);
  } catch {
    return {}; // provider 的 [DONE] / 非 JSON data 行：忽略
  }
  const obj = payload as Record<string, unknown> | null;
  const message = obj?.message;
  if (evt.event === "status") return { status: typeof message === "string" ? message : "" };
  if (evt.event === "done") return { stats: obj?.stats as MemoryStats | undefined };
  if (evt.event === "error") return { error: typeof message === "string" ? message : "分析失败" };
  const delta = parseProviderDelta(evt.data);
  return delta ? { delta } : {};
}

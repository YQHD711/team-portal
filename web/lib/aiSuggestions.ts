/**
 * 聊天页的建议问题：内容来自 `GET /api/ai/suggestions`，取不到就用**通用兜底**。
 *
 * 为什么必须有兜底、且兜底必须"通用"：以前这里写死了「1030 库房的货架分布？」「查《双频段数传》参数」
 * 这类**具体实体**，而线上知识库里并没有对应文档 —— 用户一点必然答不出来（模型只能拿通用知识编）。
 * 所以兜底问题一律不点名任何具体库房/物料/文档，任何知识库都答得上来。
 */
import { api } from "./api";

export type SuggestionKind = "doc" | "study" | "inventory";

export interface AiSuggestion {
  text: string;
  kind: SuggestionKind;
}

/** 最多展示几条（防止后端一次给一大堆把空会话撑爆） */
export const MAX_SUGGESTIONS = 6;

/** 通用兜底：不依赖任何具体数据 */
export const FALLBACK_SUGGESTIONS: AiSuggestion[] = [
  { text: "知识库里有哪些资料？", kind: "doc" },
  { text: "怎么按目录找到一份文档？", kind: "doc" },
  { text: "学习库里现在有哪些课？", kind: "study" },
  { text: "学习库该怎么开始学？", kind: "study" },
];

/**
 * 规范化接口返回：只要不是「非空数组 + 每项有非空 text」，一律返回 null，
 * 由调用方换成兜底。`kind` 认 study / inventory，**缺失或没见过的值一律按 `doc`**（不崩）。
 */
export function normalizeSuggestions(raw: unknown): AiSuggestion[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return null;

  const out: AiSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) continue;
    const kind = (item as { kind?: unknown }).kind;
    out.push({
      text: text.trim(),
      kind: kind === "study" ? "study" : kind === "inventory" ? "inventory" : "doc",
    });
  }
  return out.length > 0 ? out.slice(0, MAX_SUGGESTIONS) : null;
}

/**
 * 拉建议问题。**任何异常都不外抛**：这只是空会话上的装饰性内容，
 * 不该因为接口没上/超时/返回乱七八糟就让聊天页崩掉。
 */
export async function loadSuggestions(): Promise<AiSuggestion[]> {
  try {
    return normalizeSuggestions(await api.get<unknown>("/api/ai/suggestions")) ?? FALLBACK_SUGGESTIONS;
  } catch {
    return FALLBACK_SUGGESTIONS;
  }
}

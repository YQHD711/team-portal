"use client";

/**
 * **服务商现行可用模型**的唯一前端来源：`GET /api/admin/ai/models`（AdminOnly）。
 *
 * 为什么不再用前端硬编码列表：模型名由上游决定，官方一换名（如 `deepseek-chat` 下线）界面
 * 却仍然列着它 → 用户选中必失败的模型，而且看不出哪里不对。系统设置页早就改成了"问服务商要列表"，
 * Wiki 设置页却还留着一份写死的 `deepseek-v4-pro / v4-flash` —— 用户原话：「这里也都是过期东西」。
 *
 * 这里把逻辑抽成一处，两个页面共用同一个源。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface AiModelMeta {
  id: string;
  name?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  effortLevels?: string[];
}

interface AiModelsResponse {
  ok: boolean;
  error: string | null;
  baseUrl: string;
  models: AiModelMeta[];
}

export interface AiModelSuggestions {
  /** 模型名候选（给 ModelInput 用）；接口失败时为空数组，输入框仍可自由填写 */
  suggestions: string[];
  /** 服务商报告的完整元信息（上下文长度/输出上限/思考档位）；系统设置页展示用 */
  models: AiModelMeta[];
  loading: boolean;
  /** 失败原因（空字符串 = 成功）。**不静默**：用户要能看到"为什么没有列表" */
  error: string;
  reload: () => void;
}

export function useAiModelSuggestions(): AiModelSuggestions {
  const [models, setModels] = useState<AiModelMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get<AiModelsResponse>("/api/admin/ai/models")
      .then(res => {
        if (!alive) return;
        setModels(res.models ?? []);
        setError(res.ok ? "" : (res.error || "获取模型列表失败"));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setModels([]);
        setError(e instanceof Error ? e.message : "获取模型列表失败");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [nonce]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  return { suggestions: models.map(m => m.id), models, loading, error, reload };
}

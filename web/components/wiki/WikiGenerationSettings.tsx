"use client";

/**
 * **Wiki 生成参数**（原 `/admin/wiki-settings` 页面主体）。
 *
 * 两个用户点名的毛病在这里修掉：
 * 1) 模型候选曾经写死 `deepseek-v4-pro / v4-flash`（官方一换名就是"过期东西"）→ 现在统一走
 *    `useAiModelSuggestions()`（= `GET /api/admin/ai/models`，与系统设置页同一个源）。
 * 2) 标签写死「Temperature (DeepSeek 推荐 1.0)」「Top-P (DeepSeek 推荐 1.0)」→ 用户要求"不要写死 deepseek"，
 *    改为按**参数语义**解释（思考模式 temperature 无效 / 非思考模式 top_p 被忽略）。
 *
 * 另：**去掉「恢复默认」**。它把一份前端硬编码的默认值写回后端，等于在第二个地方维护"默认值"，
 * 必然和后端 `WikiGeneratorOptions` 漂移（这次过期就是这么来的）。改成「重新载入」= 以服务端为准。
 */

import { useEffect, useState } from "react";
import { Save, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { ModelInput } from "@/components/ui/ModelInput";
import { useAiModelSuggestions } from "@/lib/useAiModelSuggestions";

interface WikiOptions {
  catalogModel: string; contentModel: string; maxOutputTokens: number;
  parallelCount: number; maxRetryAttempts: number; retryDelayMs: number;
  directoryTreeMaxDepth: number; readmeMaxLength: number;
  documentGenerationTimeoutMinutes: number; temperature: number; topP: number;
  thinkingMode: string; documentLanguage: string;
}

const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

export function WikiGenerationSettings() {
  const [opts, setOpts] = useState<WikiOptions | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const ai = useAiModelSuggestions();

  const load = () => {
    setMsg("");
    api.get<WikiOptions>("/api/wiki/settings")
      .then(setOpts)
      .catch((e: unknown) => setMsg("❌ 读取失败：" + (e instanceof Error ? e.message : "未知错误")));
  };
  useEffect(load, []);

  const handleSave = async () => {
    if (!opts) return;
    setSaving(true);
    try { await api.put("/api/wiki/settings", opts); setMsg("✅ 已保存"); }
    catch (e) { setMsg("❌ 保存失败：" + (e instanceof Error ? e.message : "未知错误")); }
    finally { setSaving(false); }
  };

  // 收窄类型：只有 keyof WikiOptions 才允许，值类型跟随字段本身
  const upd = <K extends keyof WikiOptions>(k: K, v: WikiOptions[K]) => setOpts(o => (o ? { ...o, [k]: v } : o));

  if (!opts) {
    return <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">{msg || "载入中…"}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">目录生成模型</label>
            <ModelInput value={opts.catalogModel} onChange={v => upd("catalogModel", v)}
              suggestions={ai.suggestions} label="目录生成模型"
              placeholder="留空 = 用系统设置里的模型" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">文档生成模型</label>
            <ModelInput value={opts.contentModel} onChange={v => upd("contentModel", v)}
              suggestions={ai.suggestions} label="文档生成模型"
              placeholder="留空 = 用系统设置里的模型" />
          </div>
          <div><label className="block text-sm font-medium mb-1">最大 Token 数</label><input type="number" value={opts.maxOutputTokens} onChange={e => upd("maxOutputTokens", Number(e.target.value))} min={1024} max={131072} step={1024} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">并行数</label><input type="number" value={opts.parallelCount} onChange={e => upd("parallelCount", Number(e.target.value))} min={1} max={10} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">重试次数</label><input type="number" value={opts.maxRetryAttempts} onChange={e => upd("maxRetryAttempts", Number(e.target.value))} min={0} max={5} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">重试延迟 (ms)</label><input type="number" value={opts.retryDelayMs} onChange={e => upd("retryDelayMs", Number(e.target.value))} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">目录树深度 (-1=AI自动)</label><input type="number" value={opts.directoryTreeMaxDepth} onChange={e => upd("directoryTreeMaxDepth", Number(e.target.value))} min={-1} max={10} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">README 最大长度</label><input type="number" value={opts.readmeMaxLength} onChange={e => upd("readmeMaxLength", Number(e.target.value))} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1">阶段超时 (分钟)</label><input type="number" value={opts.documentGenerationTimeoutMinutes} onChange={e => upd("documentGenerationTimeoutMinutes", Number(e.target.value))} min={10} max={240} className={inputCls} /></div>
          <div>
            <label className="block text-sm font-medium mb-1">Temperature</label>
            <input type="number" value={opts.temperature} onChange={e => upd("temperature", Number(e.target.value))} min={0} max={2} step={0.1} className={inputCls} />
            <p className="mt-1 text-xs text-faint">仅「非推理」模式生效；推理模式下服务端固定用 top_p，temperature 被忽略。</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Top-P</label>
            <input type="number" value={opts.topP} onChange={e => upd("topP", Number(e.target.value))} min={0} max={1} step={0.1} className={inputCls} />
            <p className="mt-1 text-xs text-faint">仅「推理」模式生效；非推理模式下 top_p 被服务端忽略（固定 1.0）。</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">推理模式</label>
            <select value={opts.thinkingMode} onChange={e => upd("thinkingMode", e.target.value)} className={inputCls}>
              <option value="non-thinking">非推理（快 / 省 token）</option>
              <option value="thinking">推理（质量优先）</option>
            </select>
            <p className="mt-1 text-xs text-faint">复杂仓库会被自动切到「推理」。只有这两个取值真正被使用。</p>
          </div>
          <div><label className="block text-sm font-medium mb-1">文档语言</label><select value={opts.documentLanguage} onChange={e => upd("documentLanguage", e.target.value)} className={inputCls}><option value="zh-CN">中文</option><option value="en">English</option></select></div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "保存中…" : "保存"}</button>
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-hover"><RefreshCw className="h-4 w-4" />重新载入</button>
          <button onClick={() => ai.reload()} disabled={ai.loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-50">
            {ai.loading ? "获取中…" : "获取可用模型"}
          </button>
          {ai.error
            ? <span className="text-xs text-danger">模型列表获取失败：{ai.error}（仍可手动填写任意模型名）</span>
            : ai.suggestions.length > 0
              ? <span className="text-xs text-faint">候选来自服务商当前返回的 {ai.suggestions.length} 个模型</span>
              : <span className="text-xs text-faint">未获取到候选列表 —— 可直接手填模型名</span>}
        </div>
        {msg && <div className={`text-sm p-2 rounded-lg ${msg.startsWith("✅") ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{msg}</div>}
      </div>

      <div className="text-xs text-faint space-y-1">
        <p><strong>模型留空：</strong>目录/文档模型留空时使用「系统设置」里的模型（AI:ModelName），不再写死任何厂商的模型名。</p>
        <p><strong>自动调整：</strong>模型、并行数、超时、推理模式会按项目复杂度自动调整（简单项目走非推理省钱提速）。</p>
        <p><strong>阶段超时：</strong>每个阶段（目录生成/单文档）的超时。简单项目 30-60 分钟，复杂 120-180 分钟。</p>
        <p><strong>文档审查：</strong>生成完成后 AI 自动检查修正 Mermaid 语法、Markdown 格式等问题；也可在 Wiki 查看页点「检查修正」手动触发。</p>
      </div>
    </div>
  );
}

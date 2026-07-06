"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Save, RotateCcw, Settings } from "lucide-react";

interface WikiOptions {
  catalogModel: string; contentModel: string; maxIterations: number; maxOutputTokens: number;
  parallelCount: number; maxRetryAttempts: number; retryDelayMs: number;
  directoryTreeMaxDepth: number; readmeMaxLength: number;
  documentGenerationTimeoutMinutes: number; temperature: number; topP: number;
  thinkingMode: string; documentLanguage: string;
}

const defaults: WikiOptions = {
  catalogModel: "deepseek-v4-pro", contentModel: "deepseek-v4-pro",
  maxIterations: 30, maxOutputTokens: 32768,
  parallelCount: 3, maxRetryAttempts: 2, retryDelayMs: 2000,
  directoryTreeMaxDepth: -1, readmeMaxLength: 10000,
  documentGenerationTimeoutMinutes: 120, temperature: 1.0, topP: 1.0,
  thinkingMode: "thinking", documentLanguage: "zh-CN",
};

export default function WikiSettingsPage() {
  const [opts, setOpts] = useState<WikiOptions>(defaults);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<WikiOptions>("/api/wiki/settings").then(setOpts).catch(() => setOpts(defaults));
  }, []);

  const handleSave = async () => {
    try { await api.put("/api/wiki/settings", opts); setMsg("✅ 已保存"); } catch { setMsg("❌ 保存失败"); }
  };

  const update = (k: keyof WikiOptions, v: string | number) => setOpts({ ...opts, [k]: v });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div><h1 className="text-2xl font-bold">Wiki 设置</h1><p className="text-sm text-zinc-500">配置 AI 代码文档生成的参数</p></div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">目录生成模型</label><select value={opts.catalogModel} onChange={e => update("catalogModel", e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"><option value="deepseek-v4-pro">V4 Pro (推荐)</option><option value="deepseek-v4-flash">V4 Flash (省钱)</option></select></div>
          <div><label className="block text-sm font-medium mb-1">文档生成模型</label><select value={opts.contentModel} onChange={e => update("contentModel", e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"><option value="deepseek-v4-pro">V4 Pro (推荐)</option><option value="deepseek-v4-flash">V4 Flash (省钱)</option></select></div>
          <div><label className="block text-sm font-medium mb-1">最大迭代次数</label><input type="number" value={opts.maxIterations} onChange={e => update("maxIterations", Number(e.target.value))} min={5} max={100} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">最大 Token 数</label><input type="number" value={opts.maxOutputTokens} onChange={e => update("maxOutputTokens", Number(e.target.value))} min={1024} max={131072} step={1024} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">并行数<sup className="text-amber-500">⚠</sup></label><input type="number" value={opts.parallelCount} onChange={e => update("parallelCount", Number(e.target.value))} min={1} max={10} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">重试次数</label><input type="number" value={opts.maxRetryAttempts} onChange={e => update("maxRetryAttempts", Number(e.target.value))} min={0} max={5} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">重试延迟 (ms)</label><input type="number" value={opts.retryDelayMs} onChange={e => update("retryDelayMs", Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">目录树深度 (-1=AI自动)</label><input type="number" value={opts.directoryTreeMaxDepth} onChange={e => update("directoryTreeMaxDepth", Number(e.target.value))} min={-1} max={10} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">README 最大长度</label><input type="number" value={opts.readmeMaxLength} onChange={e => update("readmeMaxLength", Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">阶段超时 (分钟)<sup className="text-amber-500">⚠</sup></label><input type="number" value={opts.documentGenerationTimeoutMinutes} onChange={e => update("documentGenerationTimeoutMinutes", Number(e.target.value))} min={10} max={240} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">Temperature (DeepSeek 推荐 1.0)</label><input type="number" value={opts.temperature} onChange={e => update("temperature", Number(e.target.value))} min={0} max={2} step={0.1} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">Top-P (DeepSeek 推荐 1.0)</label><input type="number" value={opts.topP} onChange={e => update("topP", Number(e.target.value))} min={0} max={1} step={0.1} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" /></div>
          <div><label className="block text-sm font-medium mb-1">推理模式</label><select value={opts.thinkingMode} onChange={e => update("thinkingMode", e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"><option value="non-thinking">非推理 (快/省)</option><option value="thinking">推理 (推荐)</option><option value="thinking_max">深度推理 (最难)</option></select></div>
          <div><label className="block text-sm font-medium mb-1">文档语言</label><select value={opts.documentLanguage} onChange={e => update("documentLanguage", e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"><option value="zh-CN">中文</option><option value="en">English</option></select></div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleSave} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"><Save className="h-4 w-4" />保存</button>
          <button onClick={() => { setOpts(defaults); handleSave(); }} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm"><RotateCcw className="h-4 w-4" />恢复默认</button>
        </div>
        {msg && <div className="text-sm p-2 rounded-lg bg-green-50 dark:bg-green-950 text-green-700">{msg}</div>}
      </div>

      <div className="text-xs text-zinc-400 space-y-1">
        <p><strong>⚠ 自动调整:</strong> 标记 ⚠ 的参数在生成时会根据项目复杂度自动调整（简单项目降参数避免过度解释，复杂项目升参数深入分析）。此处设置的是默认值/上限。</p>
        <p><strong>最大迭代:</strong> AI 探索代码的工具调用轮数上限。简单项目自动 10-15，复杂项目 28-35。默认 30。</p>
        <p><strong>模型:</strong> V4 Pro 最佳质量，V4 Flash 更省钱（简单项目自动用 Flash）</p>
        <p><strong>阶段超时:</strong> 每个阶段（目录生成/单文档）的超时。简单项目 30-60 分钟，复杂 120-180 分钟。</p>
        <p><strong>Temperature / Top-P:</strong> DeepSeek 官方推荐均为 1.0</p>
        <p><strong>推理模式:</strong> thinking · non-thinking · thinking_max（复杂项目自动开启）</p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Brain, Send, Check, X, FileText, Loader2, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";

interface Proposal { id: string; title: string; description: string; filePath: string; suggestedCode: string | null; status: string; createdAt: string; }

const presets = [
  { label: "系统健康检查", task: "请对系统进行全面健康检查：分析最近的日志、错误率、数据库大小、API响应情况。给出诊断报告和改进建议。" },
  { label: "团队分析报告", task: "请分析团队的使用情况：活跃成员数、知识库使用频率、库存变化趋势。给出团队发展建议。" },
  { label: "代码质量审查", task: "请审查项目的主要代码文件，找出潜在问题、性能瓶颈、安全隐患。给出具体的改进建议。" },
  { label: "功能完善建议", task: "基于当前系统功能和使用数据，分析哪些功能需要完善或新增，按优先级排序。" },
];

export default function AIAdminPage() {
  const [task, setTask] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tab, setTab] = useState<"chat" | "proposals">("chat");

  const fetchProposals = () => {
    api.get<Proposal[]>("/api/admin/agent/proposals").then(setProposals).catch(() => {});
  };

  const runAnalysis = async (t: string) => {
    setTask(t); setLoading(true); setResult("");
    try {
      const res = await api.post<{ result: string }>("/api/admin/agent/analyze", { task: t });
      setResult(res.result);
      fetchProposals();
    } catch (e) { setResult("❌ 分析失败: " + (e instanceof Error ? e.message : "未知错误")); }
    finally { setLoading(false); }
  };

  const handleAction = async (id: string, action: "approve" | "reject") => {
    await api.post(`/api/admin/agent/proposals/${id}/${action}`, {});
    fetchProposals();
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-purple-500" />
          AI 系统管理员
        </h1>
        <p className="text-sm text-muted mt-1">自诊断 · 团队分析 · 代码提案 — 所有操作需管理员审批</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {[{ k: "chat", l: "分析对话", i: Sparkles }, { k: "proposals", l: "代码提案", i: FileText }].map(t => (
          <button key={t.k} onClick={() => { setTab(t.k as "chat" | "proposals"); if (t.k === "proposals") fetchProposals(); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.k ? "bg-white dark:bg-slate-700 shadow-sm" : "text-muted hover:text-foreground"}`}>
            <t.i className="h-4 w-4" />{t.l}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Presets */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">分析任务</h3>
            {presets.map(p => (
              <button key={p.label} onClick={() => runAnalysis(p.task)}
                disabled={loading}
                className="w-full text-left p-3 rounded-xl border border-border hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted mt-0.5 truncate">{p.task.substring(0, 50)}...</div>
              </button>
            ))}
          </div>

          {/* Chat area */}
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface flex flex-col min-h-[400px]">
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {task && (
                <div className="flex justify-end"><div className="rounded-2xl rounded-br-md bg-gradient-to-br from-purple-500 to-purple-600 text-white px-4 py-2.5 text-sm max-w-[80%] shadow-sm"><div className="font-medium text-xs mb-1 opacity-70">管理员指令</div>{task.substring(0, 100)}...</div></div>
              )}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />AI 正在分析系统数据...</div>
              )}
              {result && !loading && (
                <div className="rounded-2xl rounded-bl-md bg-slate-50 dark:bg-slate-800 border border-border px-4 py-3 text-sm">
                  <div className="font-medium text-xs text-purple-500 mb-1">AI 分析报告</div>
                  <div className="whitespace-pre-wrap leading-relaxed">{result}</div>
                </div>
              )}
              {!task && !loading && !result && (
                <div className="flex items-center justify-center h-full text-muted text-sm">
                  <div className="text-center">
                    <Brain className="h-10 w-10 mx-auto mb-2 text-purple-300" />
                    选择左侧分析任务或输入自定义指令
                  </div>
                </div>
              )}
            </div>

            {/* Custom input */}
            <div className="p-3 border-t border-border">
              <form onSubmit={e => { e.preventDefault(); if (task.trim()) runAnalysis(task); }} className="flex gap-2">
                <input value={task} onChange={e => setTask(e.target.value)} placeholder="输入自定义分析指令..."
                  className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                <button type="submit" disabled={loading || !task.trim()} className="rounded-xl bg-purple-500 px-4 py-2 text-white hover:bg-purple-600 disabled:opacity-50"><Send className="h-4 w-4" /></button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold">AI 代码改进提案</h3>
            <button onClick={fetchProposals} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4 text-muted" /></button>
          </div>
          {proposals.length === 0 ? (
            <div className="text-center py-12 text-muted"><FileText className="h-8 w-8 mx-auto mb-2" />暂无提案。在分析对话中 AI 会自动生成改进提案。</div>
          ) : proposals.map(p => (
            <div key={p.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-semibold">{p.title}</h4>
                  <div className="text-xs text-muted mt-0.5">{p.filePath} · {new Date(p.createdAt).toLocaleString("zh-CN")}</div>
                </div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.status === "pending" ? "bg-amber-100 text-amber-700" :
                  p.status === "approved" ? "bg-blue-100 text-blue-700" :
                  p.status === "applied" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                }`}>{p.status === "pending" ? "待审批" : p.status === "approved" ? "已批准" : p.status === "applied" ? "已应用" : "已拒绝"}</span>
              </div>
              <p className="text-sm text-muted mb-3">{p.description}</p>
              {p.suggestedCode && (
                <div className="rounded-xl bg-slate-900 text-slate-300 p-3 text-xs font-mono overflow-x-auto max-h-40 mb-3">
                  <pre>{p.suggestedCode.substring(0, 1000)}</pre>
                </div>
              )}
              {p.status === "pending" && (
                <div className="flex gap-2">
                  <button onClick={() => handleAction(p.id, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600">
                    <Check className="h-3 w-3" />批准并应用
                  </button>
                  <button onClick={() => handleAction(p.id, "reject")} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs">
                    <X className="h-3 w-3" />拒绝
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        批准代码提案会自动修改源文件（自动备份 .bak），请谨慎操作。
      </div>
    </div>
  );
}

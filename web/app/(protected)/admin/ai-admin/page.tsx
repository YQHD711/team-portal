"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Brain, Send, Check, X, FileText, Loader2, RefreshCw, Sparkles, AlertTriangle, Trash2, Database, Zap, ChevronDown } from "lucide-react";

interface Proposal { id: string; title: string; description: string; filePath: string; suggestedCode: string | null; status: string; createdAt: string; errorMessage?: string | null; }
interface MemoryStats { total: number; summaries: number; byRole: { role: string; count: number }[]; }

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
  const [history, setHistory] = useState<{role: string; content: string}[]>([]);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loading, result]);

  // Load existing conversation from memory
  useEffect(() => {
    api.get<MemoryStats>("/api/admin/agent/memory").then(m => {
      setMemory(m);
      // Also load recent messages for display
      fetch("/api/chat/sessions/admin-agent", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      }).then(r => r.json()).then(msgs => {
        if (Array.isArray(msgs)) setHistory(msgs.map((m: any) => ({ role: m.role, content: m.content })));
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const fetchProposals = () => {
    api.get<Proposal[]>("/api/admin/agent/proposals").then(setProposals).catch(() => {});
  };

  const clearMemory = async () => {
    if (!confirm("清除所有AI管理员记忆？此操作不可恢复。")) return;
    await api.post("/api/admin/agent/memory/clear", {});
    setHistory([]);
    setMemory({ total: 0, summaries: 0, byRole: [] });
  };

  const runAnalysis = async (t: string) => {
    setTask(t); setLoading(true); setResult("");
    // Show user message immediately
    setHistory(prev => [...prev, { role: "user", content: t }]);

    try {
      const status = await api.get<{ busy: boolean }>("/api/admin/agent/status");
      if (status.busy) {
        setHistory(prev => [...prev, { role: "assistant", content: "⏳ AI 管理员正忙，请稍后再试" }]);
        setLoading(false);
        return;
      }
    } catch { }

    try {
      const res = await api.post<{ result: string; stats: MemoryStats }>("/api/admin/agent/analyze", { task: t });
      // Show AI response immediately — no need to refresh
      setHistory(prev => [...prev, { role: "assistant", content: res.result }]);
      setMemory(res.stats);
      fetchProposals();
    } catch (e: any) {
      const errMsg = e?.message?.includes("429") ? "⏳ AI 管理员正在处理上一个任务，请等待完成后重试"
        : "❌ 分析失败: " + (e instanceof Error ? e.message : "未知错误");
      setHistory(prev => [...prev, { role: "assistant", content: errMsg }]);
    }
    finally { setLoading(false); }
  };

  const handleAction = async (id: string, action: "approve" | "reject" | "retry" | "revert") => {
    const labels = { approve: "批准并应用", reject: "拒绝", retry: "重试", revert: "回滚" };
    if (!confirm(`确认${labels[action]}此提案？`)) return;
    const res = await api.post<{ status: string; errorMessage?: string }>(`/api/admin/agent/proposals/${id}/${action}`, {});
    if (res.errorMessage) alert(`操作失败: ${res.errorMessage}`);
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
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface flex flex-col" style={{ minHeight: "60vh" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-purple-50/50 dark:bg-purple-950/20">
              <div className="flex items-center gap-2 text-xs">
                <Database className="h-3 w-3 text-purple-500" />
                <span className="text-muted">
                  连续记忆 · {memory?.total ?? "?"} 条消息
                  {memory && memory.summaries > 0 && <span className="text-purple-500 ml-1">({memory.summaries}次压缩)</span>}
                </span>
              </div>
              <button onClick={clearMemory} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-muted hover:text-red-500" title="清除记忆">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {/* System messages (compressed memory) shown as collapsible cards */}
              {history.filter(m => m.role === "system").slice(-3).map((msg, i) => (
                <div key={"sys"+i} className="text-xs text-muted bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-1.5 border border-amber-200 dark:border-amber-800">
                  {msg.content}
                </div>
              ))}
              {/* Only show last 12 messages, rest auto-compressed */}
              {history.filter(m => m.role !== "system").slice(-12).map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : ""}`}>
                  <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[80%] shadow-sm ${
                    msg.role === "user" ? "rounded-br-md bg-gradient-to-br from-purple-500 to-purple-600 text-white" : "rounded-bl-md bg-slate-50 dark:bg-slate-800 border border-border"
                  }`}>
                    {msg.role === "user" && <div className="font-medium text-xs mb-1 opacity-70">管理员指令</div>}
                    <div className="whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{msg.content}</div>
                  </div>
                </div>
              ))}
              {history.filter(m => m.role !== "system").length > 12 && (
                <div className="text-center text-xs text-muted py-1 border-t border-border">
                  ↑ 以上仅显示最近12条消息，更早内容已压缩为记忆摘要
                </div>
              )}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />AI 正在分析系统数据...</div>
              )}
              {history.length === 0 && !loading && (
                <div className="flex items-center justify-center h-full text-muted text-sm">
                  <div className="text-center">
                    <Brain className="h-10 w-10 mx-auto mb-2 text-purple-300" />
                    选择左侧分析任务或输入自定义指令<br />
                    <span className="text-xs text-muted mt-1">所有对话在一个记忆体中，超过45条自动压缩</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Custom input */}
            <div className="p-3 border-t border-border">
              <form onSubmit={e => { e.preventDefault(); if (task.trim()) { runAnalysis(task); setTask(""); } }} className="flex gap-2">
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
                  p.status === "applied" ? "bg-green-100 text-green-700" :
                  p.status === "failed" ? "bg-red-100 text-red-700" :
                  p.status === "reverted" ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-600"
                }`}>{p.status === "pending" ? "待审批" : p.status === "approved" ? "已批准" : p.status === "applied" ? "已应用" : p.status === "failed" ? "失败" : p.status === "reverted" ? "已回滚" : "已拒绝"}</span>
              </div>
              <p className="text-sm text-muted mb-3">{p.description}</p>
              {p.suggestedCode && (
                <div className="rounded-xl bg-slate-900 text-slate-300 p-3 text-xs font-mono overflow-x-auto max-h-40 mb-3">
                  <pre>{p.suggestedCode.substring(0, 1000)}</pre>
                </div>
              )}
              {/* Error message */}
              {p.status === "failed" && p.errorMessage && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/50 rounded-lg p-2 mb-2 font-mono">{p.errorMessage}</div>
              )}

              {/* Action buttons by status */}
              <div className="flex gap-2">
                {p.status === "pending" && (
                  <>
                    <button onClick={() => handleAction(p.id, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600">
                      <Check className="h-3 w-3" />批准并应用
                    </button>
                    <button onClick={() => handleAction(p.id, "reject")} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs">
                      <X className="h-3 w-3" />拒绝
                    </button>
                  </>
                )}
                {p.status === "rejected" && (
                  <button onClick={() => handleAction(p.id, "retry")} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
                    <RefreshCw className="h-3 w-3" />重新提交
                  </button>
                )}
                {p.status === "failed" && (
                  <button onClick={() => handleAction(p.id, "retry")} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
                    <RefreshCw className="h-3 w-3" />重试
                  </button>
                )}
                {p.status === "applied" && (
                  <button onClick={() => handleAction(p.id, "revert")} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                    <RefreshCw className="h-3 w-3" />回滚
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Maintenance Panel */}
      <div className="rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-purple-500" />维护模式
          </h3>
          <span className="text-xs text-muted">一键编译 · 自动回滚</span>
        </div>
        {/* Maintenance result message */}
        {result && (
          <div className={`text-sm p-3 rounded-xl whitespace-pre-wrap font-mono ${
            result.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" :
            result.startsWith("❌") ? "bg-red-50 dark:bg-red-950 text-red-600" :
            result.startsWith("🔨") ? "bg-blue-50 dark:bg-blue-950 text-blue-600" :
            "bg-slate-50 dark:bg-slate-800 text-slate-600"
          }`}>{result}</div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button onClick={async () => {
            if (!confirm("编译并应用所有【已批准】提案？\n成功→代码生效，需手动重启后端\n失败→自动 git 回滚")) return;
            setResult("🔨 正在编译...（可能需要10-30秒）");
            try {
              const res = await api.post<{success:boolean, message:string, error?:string, fullOutput?:string}>("/api/admin/maintenance/apply", {});
              if (res.success) {
                setResult(`✅ ${res.message}`);
              } else if (res.message?.includes("没有待应用")) {
                setResult(`ℹ️ ${res.message}`);
              } else {
                setResult(`❌ ${res.message}\n\n错误：${res.error || '未知'}\n\n详情：${(res.fullOutput || '').substring(0, 500)}`);
              }
              fetchProposals();
            } catch (e: any) { setResult("❌ 维护操作失败: " + (e?.message || '网络错误')); }
          }} className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-600">
            <RefreshCw className="h-3 w-3" />应用（需手动重启）
          </button>
          <button onClick={async () => {
            if (!confirm("⚠️ 回滚到上次编译前状态？")) return;
            try {
              const res = await api.post<{success:boolean, message:string}>("/api/admin/maintenance/rollback", {});
              setResult(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
              fetchProposals();
            } catch { setResult("❌ 回滚失败"); }
          }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
            <RefreshCw className="h-3 w-3" />回滚
          </button>
          <button onClick={async () => {
            try {
              const res = await api.get<{log:string, status:string}>("/api/admin/maintenance");
              setResult("📋 变更历史:\n" + res.log);
            } catch (e: any) { setResult("❌ 获取历史失败: " + (e?.message || "")); }
          }} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs">
            <FileText className="h-3 w-3" />变更历史
          </button>
        </div>
      </div>
    </div>
  );
}

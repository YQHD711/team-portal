"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Brain, FileText, Sparkles } from "lucide-react";
import ChatTab from "@/components/admin/ai-admin/ChatTab";
import ProposalsTab from "@/components/admin/ai-admin/ProposalsTab";
import MaintenancePanel from "@/components/admin/ai-admin/MaintenancePanel";
import type { MemoryStats, Proposal } from "@/components/admin/ai-admin/aiAdminTypes";

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
      const res = await api.post<{ result: string; stats: MemoryStats }>("/api/admin/agent/analyze", { task: t }, 900000); // 15 min timeout for AI analysis
      // Show AI response immediately — no need to refresh
      setHistory(prev => [...prev, { role: "assistant", content: res.result }]);
      setMemory(res.stats);
      fetchProposals();
    } catch (e: any) {
      const msg = e?.message || (e instanceof Error ? e.message : "未知错误");
      const errMsg = msg.includes("429") ? "⏳ AI 管理员正在处理上一个任务，请等待完成后重试"
        : msg.includes("超时") ? "⏱️ AI 分析超时（15分钟），请简化任务或调大超时设置"
        : "❌ 分析失败: " + msg;
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
        <ChatTab history={history} loading={loading} memory={memory} task={task}
          onTask={setTask} onRun={runAnalysis} onClearMemory={clearMemory} chatEndRef={chatEndRef} />
      ) : (
        <ProposalsTab proposals={proposals} onAction={handleAction} onRefresh={fetchProposals} />
      )}

      {/* Maintenance Panel */}
      <MaintenancePanel result={result} setResult={setResult} onProposalsChanged={fetchProposals} />
    </div>
  );
}

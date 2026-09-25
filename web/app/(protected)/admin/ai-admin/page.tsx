"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Brain, BookOpen, Sparkles } from "lucide-react";
import ChatTab from "@/components/admin/ai-admin/ChatTab";
import AssistantInfoTab from "@/components/admin/ai-admin/AssistantInfoTab";
import type { AgentTool, ChatEntry, GuideSection, MemoryStats } from "@/components/admin/ai-admin/aiAdminTypes";

export default function AIAdminPage() {
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"chat" | "guide">("chat");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [guide, setGuide] = useState<GuideSection[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loading]);

  // Load existing conversation from memory
  useEffect(() => {
    api.get<MemoryStats>("/api/admin/agent/memory").then(setMemory).catch(() => {});
    api.get<ChatEntry[]>("/api/chat/sessions/admin-agent").then(msgs => {
      if (Array.isArray(msgs)) setHistory(msgs.map(m => ({ role: m.role, content: m.content })));
    }).catch(() => {});
    api.get<AgentTool[]>("/api/admin/agent/tools").then(t => { if (Array.isArray(t)) setTools(t); }).catch(() => {});
    api.get<GuideSection[]>("/api/admin/agent/guide").then(g => { if (Array.isArray(g)) setGuide(g); }).catch(() => {});
  }, []);

  const clearMemory = async () => {
    if (!confirm("清除所有AI管理员记忆？此操作不可恢复。")) return;
    await api.post("/api/admin/agent/memory/clear", {});
    setHistory([]);
    setMemory({ total: 0, summaries: 0, byRole: [] });
  };

  const runAnalysis = async (t: string) => {
    setTask(t);
    setLoading(true);
    // Show user message immediately
    setHistory(prev => [...prev, { role: "user", content: t }]);

    try {
      const status = await api.get<{ busy: boolean }>("/api/admin/agent/status");
      if (status.busy) {
        setHistory(prev => [...prev, { role: "assistant", content: "⏳ AI 管理员正忙，请稍后再试" }]);
        return;
      }
    } catch { /* 状态查询失败不阻塞主流程 */ }

    try {
      const res = await api.post<{ result: string; stats: MemoryStats }>("/api/admin/agent/analyze", { task: t }, 900000); // 15 min timeout for AI analysis
      setHistory(prev => [...prev, { role: "assistant", content: res.result }]);
      setMemory(res.stats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知错误";
      const errMsg = msg.includes("429") ? "⏳ AI 管理员正在处理上一个任务，请等待完成后重试"
        : msg.includes("超时") ? "⏱️ AI 分析超时（15分钟），请简化问题或调大超时设置"
        : "❌ 分析失败: " + msg;
      setHistory(prev => [...prev, { role: "assistant", content: errMsg }]);
    }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-purple-500" />
          AI 系统管理员
        </h1>
        <p className="text-sm text-muted mt-1">
          只读运维助手 · 系统诊断 · 排障答疑 — 不修改数据、不改代码、不编译、不重启服务
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-hover p-1 w-fit">
        {[{ k: "chat", l: "运维对话", i: Sparkles }, { k: "guide", l: "能力与手册", i: BookOpen }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as "chat" | "guide")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.k ? "bg-white dark:bg-slate-700 shadow-sm" : "text-muted hover:text-foreground"}`}>
            <t.i className="h-4 w-4" />{t.l}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <ChatTab history={history} loading={loading} memory={memory} task={task}
          onTask={setTask} onRun={runAnalysis} onClearMemory={clearMemory} chatEndRef={chatEndRef} />
      ) : (
        <AssistantInfoTab tools={tools} guide={guide} />
      )}
    </div>
  );
}

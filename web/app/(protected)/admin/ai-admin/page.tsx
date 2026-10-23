"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Brain, BookOpen, Sparkles } from "lucide-react";
import ChatTab from "@/components/admin/ai-admin/ChatTab";
import AssistantInfoTab from "@/components/admin/ai-admin/AssistantInfoTab";
import { createAgentSseParser, interpretAgentEvent } from "@/components/admin/ai-admin/agentStream";
import type { AgentTool, ChatEntry, GuideSection, MemoryStats } from "@/components/admin/ai-admin/aiAdminTypes";

export default function AIAdminPage() {
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"chat" | "guide">("chat");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [guide, setGuide] = useState<GuideSection[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to latest message
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loading]);

  // 卸载时取消进行中的流：否则离开页面后上游模型仍会继续生成（白花 token）
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load existing conversation from memory
  useEffect(() => {
    api.get<MemoryStats>("/api/admin/agent/memory").then(setMemory).catch(() => {});
    api.get<ChatEntry[]>("/api/chat/sessions/admin-agent").then(msgs => {
      if (Array.isArray(msgs)) setHistory(msgs.map(m => ({ role: m.role, content: m.content })));
    }).catch(() => {});
    api.get<AgentTool[]>("/api/admin/agent/tools").then(t => { if (Array.isArray(t)) setTools(t); }).catch(() => {});
    api.get<GuideSection[]>("/api/admin/agent/guide").then(g => { if (Array.isArray(g)) setGuide(g); }).catch(() => {});
  }, []);

  /** 把增量追加到"最后一条 assistant 消息"；还没有就新建一条。 */
  const appendAssistant = (text: string) => setHistory(prev => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + text };
    else next.push({ role: "assistant", content: text });
    return next;
  });

  /** 错误提示单独成段（已有正文时换行，避免糊在一起）。 */
  const appendError = (text: string) => setHistory(prev => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content ? `${last.content}\n\n${text}` : text };
    else next.push({ role: "assistant", content: text });
    return next;
  });

  const clearMemory = async () => {
    if (!confirm("清除所有AI管理员记忆？此操作不可恢复。")) return;
    await api.post("/api/admin/agent/memory/clear", {});
    setHistory([]);
    setMemory({ total: 0, summaries: 0, byRole: [] });
  };

  const cancelAnalysis = () => abortRef.current?.abort();

  const runAnalysis = async (t: string) => {
    if (loading) return; // busy 检查（按钮也 disabled，双保险）
    setTask(t);
    setLoading(true);
    setStatus("正在连接 AI 管理员…");
    setHistory(prev => [...prev, { role: "user", content: t }]);

    try {
      const statusRes = await api.get<{ busy: boolean }>("/api/admin/agent/status");
      if (statusRes.busy) {
        setHistory(prev => [...prev, { role: "assistant", content: "⏳ AI 管理员正忙，请稍后再试" }]);
        setLoading(false);
        setStatus("");
        return;
      }
    } catch { /* 状态查询失败不阻塞主流程 */ }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.stream("/api/admin/agent/analyze/stream", { task: t }, 60_000, controller.signal);
      if (!res.body) throw new Error("服务端没有返回数据流");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parse = createAgentSseParser(evt => {
        const update = interpretAgentEvent(evt);
        if (update.status) setStatus(update.status);
        if (update.delta) appendAssistant(update.delta);
        if (update.stats) setMemory(update.stats);
        if (update.error) { setStatus(""); appendError(update.error); }
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(decoder.decode(value, { stream: true }));
      }
      parse(decoder.decode()); // flush 末尾残余（正常每帧以空行结束，这里兜底）
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知错误";
      if (controller.signal.aborted) {
        appendError("⏹️ 已停止分析");
      } else if (msg.includes("429")) {
        appendError("⏳ AI 管理员正在处理上一个任务，请等待完成后重试");
      } else if (msg.includes("请求超时")) {
        appendError("⏱️ 连接超时：长分析请保持页面打开，或稍后重试");
      } else {
        appendError("❌ 分析失败: " + msg);
      }
    } finally {
      setLoading(false);
      setStatus("");
      if (abortRef.current === controller) abortRef.current = null;
    }
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
        <ChatTab history={history} loading={loading} status={status} memory={memory} task={task}
          onTask={setTask} onRun={runAnalysis} onCancel={cancelAnalysis} onClearMemory={clearMemory} chatEndRef={chatEndRef} />
      ) : (
        <AssistantInfoTab tools={tools} guide={guide} />
      )}
    </div>
  );
}
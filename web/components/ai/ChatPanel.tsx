"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, Plus, MessageSquare, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useBrand } from "@/lib/brand";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  sessionId: string;
  title: string;
  messageCount: number;
  lastMessage: string;
}

/** 建议问题 chips（空会话时展示，点击填入输入框） */
const SUGGESTIONS = [
  "1030 库房的货架分布？",
  "某物料还剩多少？",
  "查《双频段数传》参数",
  "如何领用 B 级物料？",
];

export function ChatPanel() {
  const { teamSubtitle } = useBrand();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollDown(); }, [messages, scrollDown]);

  // Load sessions on mount
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/chat/sessions", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setSessions(d))
      .catch(() => {});
  }, []);

  // Generate new session ID
  const newSession = useCallback(async () => {
    setMessages([]);
    try {
      const token = getToken();
      const res = await fetch("/api/chat/new-session", { headers: { Authorization: `Bearer ${token}` } });
      const { sessionId: sid } = await res.json();
      setSessionId(sid);
      localStorage.setItem("chatSessionId", sid);
      setShowHistory(false);
    } catch { setSessionId((crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 14)).slice(0, 12)); }
  }, []);

  // Load messages for a session
  const loadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    localStorage.setItem("chatSessionId", sid);
    setShowHistory(false);
    try {
      const token = getToken();
      const res = await fetch(`/api/chat/sessions/${sid}`, { headers: { Authorization: `Bearer ${token}` } });
      const history = await res.json();
      setMessages(history.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })));
    } catch { setMessages([]); }
  }, []);

  // Delete session
  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const token = getToken();
      await fetch(`/api/chat/sessions/${sid}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setSessions(prev => prev.filter(s => s.sessionId !== sid));
      if (sessionId === sid) { setSessionId(""); setMessages([]); }
    } catch { }
  };

  // Initialize: restore from localStorage or create new
  useEffect(() => {
    if (sessionId) return;
    const stored = localStorage.getItem("chatSessionId");
    if (stored) { setSessionId(stored); return; }
    newSession();
  }, [sessionId, newSession]);

  const handleSend = async () => {
    if (!input.trim() || streaming || !sessionId) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const token = getToken();
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: userMsg.content, sessionId }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.choices?.[0]?.delta?.content) {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + parsed.choices[0].delta.content };
                  return updated;
                });
              }
            } catch { }
          }
        }
      }
      // Refresh session list
      const token2 = getToken();
      fetch("/api/chat/sessions", { headers: { Authorization: `Bearer ${token2}` } })
        .then(r => r.json()).then(d => setSessions(d)).catch(() => {});
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: "抱歉，AI 服务暂不可用。" };
        return updated;
      });
    } finally { setStreaming(false); }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 16%, transparent), transparent)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--primary) 6%, transparent), 0 12px 32px -20px color-mix(in srgb, var(--primary) 40%, transparent)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div
          className="flex items-center justify-center w-7 h-7 rounded-lg text-white shrink-0"
          style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sm">AI 助手</span>
        <span className="text-xs text-muted">有记忆 · 知识库 RAG</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={newSession} className="p-1.5 rounded-lg hover:bg-surface-hover" title="新对话">
            <Plus className="h-3.5 w-3.5 text-muted" />
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className="p-1.5 rounded-lg hover:bg-surface-hover" title="对话历史">
            {showHistory ? <ChevronUp className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
          </button>
        </div>
      </div>

      {/* Session history dropdown */}
      {showHistory && (
        <div className="border-b border-border max-h-48 overflow-y-auto bg-surface-subtle">
          {sessions.length === 0 ? (
            <div className="p-3 text-xs text-muted text-center">暂无历史对话</div>
          ) : (
            sessions.map(s => (
              <div key={s.sessionId} onClick={() => loadSession(s.sessionId)}
                className={`flex items-center gap-2 px-4 py-2 cursor-pointer text-sm hover:bg-surface-hover ${s.sessionId === sessionId ? "bg-primary/10" : ""}`}>
                <MessageSquare className="h-3.5 w-3.5 text-muted shrink-0" />
                <span className="flex-1 truncate">{s.title}</span>
                <span className="text-xs text-muted shrink-0">{s.messageCount}条</span>
                <button onClick={(e) => deleteSession(s.sessionId, e)} className="p-0.5 rounded hover:bg-danger/10 text-muted hover:text-danger shrink-0">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 min-h-[200px] sm:min-h-[300px] max-h-[350px] sm:max-h-[450px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Bot className="h-10 w-10 mb-3 text-muted" />
            <p className="text-sm text-muted">问我任何关于{teamSubtitle}的问题</p>
            <p className="text-xs text-faint mt-1">我会记住对话上下文，并从知识库中查找信息</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-subtle shrink-0 mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[85%] sm:max-w-[75%] shadow-sm ${
              msg.role === "user" ? "bg-primary text-white rounded-br-md" : "bg-surface border border-border rounded-bl-md"
            }`}>
              {msg.content ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : streaming && i === messages.length - 1 ? (
                <div className="flex items-center gap-1.5 text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs">思考中...</span>
                </div>
              ) : null}
            </div>
            {msg.role === "user" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-subtle shrink-0 mt-0.5">
                <User className="h-4 w-4 text-muted" />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 建议问题 chips（空会话时展示） */}
      {messages.length === 0 && (
        <div className="px-4 pb-1 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setInput(s)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface text-muted hover:border-primary hover:text-foreground transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border bg-surface-subtle">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入问题..." disabled={streaming}
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50 transition-shadow" />
          <button type="submit" disabled={streaming || !input.trim()}
            className="rounded-xl bg-primary px-4 py-2.5 text-white hover:bg-accent-hover disabled:opacity-50 transition-all shadow-lg shadow-primary/20 flex items-center">
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { ChatView, type ChatMessage, type ChatSession } from "./ChatView";

/**
 * AI 助手聊天面板：会话/消息状态与流式发送都在这里，展示交给 ChatView
 * （建议问题 chips 由 SuggestionChips 自己从 /api/ai/suggestions 拉，见 lib/aiSuggestions）。
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
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
      const res = await fetch(`/api/chat/sessions/${sid}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      // 未校验 res.ok 就本地删除:失败时列表已移除但服务端仍在,刷新后会话又出现
      if (!res.ok) return;
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

    const userMsg: ChatMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
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
    <ChatView
      messages={messages} streaming={streaming} input={input}
      sessions={sessions} sessionId={sessionId} showHistory={showHistory} bottomRef={bottomRef}
      onNew={newSession} onToggleHistory={() => setShowHistory(!showHistory)}
      onOpenSession={loadSession} onDeleteSession={deleteSession}
      onInput={setInput} onSend={handleSend}
    />
  );
}

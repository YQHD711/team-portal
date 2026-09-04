"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";

interface Session { sessionId: string; title: string; messageCount: number; lastMessage: string; }

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  // Load sessions on open
  useEffect(() => {
    if (!open || !getToken()) return;
    api.get<Session[]>("/api/chat/sessions").then(setSessions).catch(() => {});
  }, [open]);

  // Restore last session from localStorage (shared with ChatPanel)
  useEffect(() => {
    if (!getToken()) return;
    const stored = localStorage.getItem("chatSessionId");
    if (stored) {
      setSessionId(stored);
    } else {
      api.get<{ sessionId: string }>("/api/chat/new-session")
        .then(d => {
          setSessionId(d.sessionId);
          localStorage.setItem("chatSessionId", d.sessionId);
        }).catch(() => {});
    }
    setLoaded(true);
  }, []);

  // Load history when sessionId changes
  const loadHistory = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const history = await api.get<{ role: string; content: string }[]>(`/api/chat/sessions/${sid}`);
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
      } else {
        setMessages([]);
      }
    } catch { setMessages([]); }
  }, []);

  useEffect(() => { if (open && sessionId) loadHistory(sessionId); }, [open, sessionId, loadHistory]);

  const switchSession = (sid: string) => {
    setSessionId(sid);
    localStorage.setItem("chatSessionId", sid);
  };

  const newChat = async () => {
    setMessages([]);
    try {
      const { sessionId: sid } = await api.get<{ sessionId: string }>("/api/chat/new-session");
      setSessionId(sid);
      localStorage.setItem("chatSessionId", sid);
    } catch { }
  };

  const deleteChat = async (sid: string) => {
    try {
      await api.delete(`/api/chat/sessions/${sid}`);
      setSessions(prev => prev.filter(s => s.sessionId !== sid));
      if (sessionId === sid) { setSessionId(""); setMessages([]); localStorage.removeItem("chatSessionId"); }
    } catch { }
  };

  const send = async () => {
    const q = question.trim(); if (!q || !sessionId || sending) return;
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setSending(true);

    try {
      const res = await api.stream("/api/ai/chat", { question: q, sessionId });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try { const json = JSON.parse(data); full += json.choices?.[0]?.delta?.content || ""; } catch { }
          }
        }
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") last.content = full;
          else copy.push({ role: "assistant", content: full });
          return [...copy];
        });
      }
      // Refresh sessions
      api.get<Session[]>("/api/chat/sessions").then(setSessions).catch(() => {});
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "抱歉，AI 服务暂时不可用" }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-16 sm:bottom-6 right-4 sm:right-6 z-50 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-accent-hover transition-all hover:scale-105"
        title="AI 助手"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-16 right-2 sm:right-6 z-50 w-[calc(100vw-1rem)] sm:w-96 rounded-2xl border border-border dark:border-zinc-700 bg-surface shadow-2xl flex flex-col" style={{ maxHeight: "70vh" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm text-purple-600 dark:text-purple-400">AI 助手</span>
            <div className="flex items-center gap-1">
              <button onClick={newChat} className="p-1 rounded hover:bg-surface-hover" title="新对话"><Plus className="h-4 w-4 text-faint" /></button>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-surface-hover"><X className="h-4 w-4 text-faint" /></button>
            </div>
          </div>

          {/* Session switcher */}
          {sessions.length > 0 && messages.length === 0 && (
            <div className="border-b border-border max-h-36 overflow-y-auto">
              {sessions.slice(0, 5).map(s => (
                <div key={s.sessionId} onClick={() => switchSession(s.sessionId)}
                  className={`flex items-center gap-2 px-4 py-2 cursor-pointer text-sm hover:bg-surface-hover ${s.sessionId === sessionId ? "bg-purple-50 dark:bg-purple-950" : ""}`}>
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className="text-xs text-faint">{s.messageCount}条</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteChat(s.sessionId); }} className="p-0.5 rounded hover:bg-red-50 text-faint hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[150px]">
            {!loaded ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-300" /></div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-faint text-center pt-8">问我任何关于航模、零件、飞行日志的问题</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
                  <div className={`inline-block max-w-[85%] rounded-xl px-3 py-2 ${m.role === "user" ? "bg-primary text-white rounded-br-sm" : "bg-surface-subtle text-zinc-800 dark:text-zinc-200 rounded-bl-sm"}`}>
                    {m.content || (m.role === "assistant" && sending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "")}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-border">
            <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2">
              <input ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} placeholder="输入问题..." disabled={sending || !loaded}
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50" />
              <button type="submit" disabled={sending || !question.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-white hover:bg-accent-hover disabled:opacity-50">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

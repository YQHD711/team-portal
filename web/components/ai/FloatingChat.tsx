"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = async () => {
    const q = question.trim(); if (!q) return;
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setSending(true);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q, sessionId }),
      });
      // Handle SSE stream
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
            try { const json = JSON.parse(data); full += json.content || ""; } catch {}
          }
        }
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            last.content = full;
          } else {
            copy.push({ role: "assistant", content: full });
          }
          return [...copy];
        });
      }
      // Get sessionId from response header
      const sid = res.headers.get("X-Session-Id");
      if (sid) setSessionId(sid);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "抱歉，AI 服务暂时不可用" }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-purple-500 text-white shadow-lg hover:bg-purple-600 transition-all hover:scale-105"
        title="AI 助手"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-80 sm:w-96 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col" style={{ maxHeight: "60vh" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <span className="font-semibold text-sm text-purple-600 dark:text-purple-400">AI 助手</span>
            <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px]">
            {messages.length === 0 && (
              <p className="text-sm text-zinc-400 text-center pt-8">问我任何关于航模、零件、飞行日志的问题</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block max-w-[85%] rounded-xl px-3 py-2 ${
                  m.role === "user"
                    ? "bg-purple-500 text-white rounded-br-sm"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-bl-sm"
                }`}>
                  {m.content || (m.role === "assistant" && sending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "")}
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
            <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2">
              <input
                ref={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="输入问题..."
                disabled={sending}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-purple-400 disabled:opacity-50"
              />
              <button type="submit" disabled={sending || !question.trim()}
                className="rounded-lg bg-purple-500 px-3 py-1.5 text-white hover:bg-purple-600 disabled:opacity-50">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

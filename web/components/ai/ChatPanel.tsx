"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { getToken } from "@/lib/auth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const token = getToken();
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: userMsg.content }),
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
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: updated[updated.length - 1].content + parsed.choices[0].delta.content,
                  };
                  return updated;
                });
              }
            } catch { /* skip unparseable */ }
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "抱歉，AI 服务暂不可用。请确认已配置 DEEPSEEK_API_KEY 环境变量。",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-sky-50 to-transparent dark:from-sky-950/20">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="font-medium text-sm">AI 助手</span>
        <span className="text-xs text-zinc-400 ml-auto">基于知识库检索</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[450px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Bot className="h-10 w-10 mb-3 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              问我任何关于航模队的问题
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              我会从知识库中查找相关信息来回答
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-900 shrink-0 mt-0.5">
                <Bot className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              </div>
            )}
            <div
              className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[85%] sm:max-w-[75%] ${
                msg.role === "user"
                  ? "bg-sky-500 text-white rounded-br-md"
                  : "bg-zinc-100 dark:bg-zinc-800 rounded-bl-md"
              }`}
            >
              {msg.content ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : streaming && i === messages.length - 1 ? (
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs">思考中...</span>
                </div>
              ) : null}
            </div>
            {msg.role === "user" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0 mt-0.5">
                <User className="h-4 w-4 text-zinc-500" />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入问题..."
            disabled={streaming}
            className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-sky-500 px-4 py-2.5 text-white hover:bg-sky-600 disabled:opacity-50 transition-colors shadow-sm flex items-center"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

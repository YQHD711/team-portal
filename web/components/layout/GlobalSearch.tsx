"use client";

import { useState, useEffect, useRef } from "react";
import { Search, FileText, Package, GitBranch, Upload, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface SearchResult {
  knowledge: { type: string; title: string; snippet: string; path: string }[];
  inventory: { type: string; title: string; snippet: string; path: string }[];
  wiki: { type: string; title: string; snippet: string; path: string }[];
  files: { type: string; title: string; snippet: string; path: string }[];
}

const typeIcons: Record<string, typeof FileText> = {
  knowledge: FileText, inventory: Package, wiki: GitBranch, file: Upload,
};
const typeLabels: Record<string, string> = {
  knowledge: "知识库", inventory: "库存", wiki: "Wiki", file: "文件",
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && e.target === document.body)) {
        e.preventDefault(); setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 100); } }, [open]);

  useEffect(() => {
    if (q.length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const r = await api.get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`); setResults(r); }
      catch { setResults(null); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const allResults = results ? [
    ...results.knowledge, ...results.inventory, ...results.wiki, ...results.files
  ] : [];

  const navigate = (path: string) => { setOpen(false); setQ(""); setResults(null); window.location.href = path; };

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl text-sm text-muted bg-surface hover:bg-surface-hover border border-border-subtle transition-colors sm:min-w-[200px]">
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden sm:block flex-1 text-left">搜索...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border-subtle px-1.5 py-0.5 text-[10px] text-faint font-mono">Ctrl+K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-xl mx-4 rounded-2xl bg-surface shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
              {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Search className="h-5 w-5 text-muted" />}
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                placeholder="搜索知识库、库存、Wiki、文件..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
              <kbd className="text-[10px] text-faint font-mono border border-border-subtle rounded-md px-1.5 py-0.5">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {!results && q.length < 2 && (
                <div className="p-8 text-center text-sm text-faint">输入至少 2 个字符开始搜索</div>
              )}
              {allResults.length === 0 && q.length >= 2 && !loading && (
                <div className="p-8 text-center text-sm text-faint">未找到相关结果</div>
              )}
              {allResults.map((r, i) => {
                const Icon = typeIcons[r.type] || FileText;
                return (
                  <button key={i} onClick={() => navigate(r.path)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-surface-subtle">
                      <Icon className="h-4 w-4 text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      <div className="text-xs text-muted truncate mt-0.5">{r.snippet}</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted bg-surface-subtle px-1.5 py-0.5 rounded-full">
                      {typeLabels[r.type]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

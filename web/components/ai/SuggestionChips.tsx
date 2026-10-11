"use client";

import { useEffect, useState } from "react";
import { FileText, GraduationCap, Package } from "lucide-react";
import { loadSuggestions, type AiSuggestion, type SuggestionKind } from "@/lib/aiSuggestions";

/** kind → 图标：study 学习类、inventory 库存/货架类、doc（及未知）文件类 */
function KindIcon({ kind }: { kind: SuggestionKind }) {
  if (kind === "study") return <GraduationCap className="h-3 w-3" aria-hidden data-testid="suggestion-icon-study" />;
  if (kind === "inventory") return <Package className="h-3 w-3" aria-hidden data-testid="suggestion-icon-inventory" />;
  return <FileText className="h-3 w-3" aria-hidden data-testid="suggestion-icon-doc" />;
}

/**
 * 空会话的建议问题 chips：内容来自 `/api/ai/suggestions`，拿不到就用通用兜底（见 lib/aiSuggestions）。
 * 加载完成前**什么都不渲染** —— 不能先闪一组写死的问题再被替换。
 */
export function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  const [items, setItems] = useState<AiSuggestion[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSuggestions().then(list => { if (!cancelled) setItems(list); });
    return () => { cancelled = true; };
  }, []);

  if (!items) return null;

  return (
    <div data-testid="ai-suggestions" className="px-4 pb-1 flex flex-wrap gap-2">
      {items.map(s => (
        <button key={s.text} type="button" data-testid="ai-suggestion" data-kind={s.kind}
          onClick={() => onPick(s.text)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-surface text-muted hover:border-primary hover:text-foreground transition-colors">
          <KindIcon kind={s.kind} />
          {s.text}
        </button>
      ))}
    </div>
  );
}

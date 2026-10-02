"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { PROSE_CLASS } from "./proseClass";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { blockContent, replaceBlock, splitMarkdownBlocks } from "@/lib/mdBlocks";

interface Props {
  content: string;
  docPath?: string;
  onNavigate?: (path: string, hash?: string) => void;
  highlight?: string;
  /**
   * 传了才启用块级就地编辑（权限由调用方判定，这里只负责 UI）。
   * 保存时把**整篇新内容**交给它 —— 未编辑的块由 mdBlocks 的逐字切片保证一个字符都不变。
   */
  onSave?: (nextContent: string) => Promise<void> | void;
  /** aria-label 里指代这篇文档，例如「课时」 */
  label?: string;
}

/**
 * 块级就地编辑：点某一块右侧的「编辑」→ 该块变成 textarea（编辑的是这一块的原始 markdown）
 * → 保存后只把这一段切片写回源文本，其余部分逐字不变（见 lib/mdBlocks.ts 的不变量）。
 *
 * 不传 onSave 时退化成普通的 MarkdownRenderer（逐字一致的只读行为）。
 */
export function BlockEditor({ content, docPath, onNavigate, highlight, onSave, label = "文档" }: Props) {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!onSave) return <MarkdownRenderer content={content} docPath={docPath} onNavigate={onNavigate} highlight={highlight} />;

  const startEdit = (i: number) => { setEditing(i); setDraft(blockContent(blocks[i])); setError(""); };
  const cancel = () => { setEditing(null); setDraft(""); setError(""); };

  const commit = async () => {
    if (editing === null) return;
    const next = replaceBlock(content, blocks[editing], draft);
    if (next === content) { cancel(); return; }
    setSaving(true); setError("");
    try { await onSave(next); setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  return (
    <div className={PROSE_CLASS} data-testid="md-blocks">
      <p className="not-prose mb-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-faint">
        <Pencil className="h-3 w-3" />点到哪一块就改哪一块（编辑的是原始 Markdown，只保存这一块）
      </p>

      {blocks.map((b, i) => {
        if (b.kind === "blank") return <span key={i} data-testid="md-block" data-block-kind="blank" />;

        if (i === editing) {
          return (
            <div key={i} data-testid="md-block" data-block-kind={b.kind}
              className="not-prose my-3 rounded-lg border border-sky-400 bg-surface p-2">
              <textarea data-testid="md-block-editor" value={draft} autoFocus
                aria-label={`编辑${label}这一块的原始 Markdown`}
                rows={Math.min(24, draft.split("\n").length + 1)}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") cancel();
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit();
                }}
                className="w-full resize-y rounded border border-border bg-background p-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" data-testid="md-block-save" onClick={() => void commit()} disabled={saving}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                  {saving ? "保存中…" : "保存这一块"}
                </button>
                <button type="button" data-testid="md-block-cancel" onClick={cancel}
                  className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-surface-hover">取消</button>
                <span className="text-[11px] text-faint">Ctrl/⌘+Enter 保存 · Esc 取消</span>
                {error && <span data-testid="md-block-error" className="text-xs text-danger">{error}</span>}
              </div>
            </div>
          );
        }

        return (
          <div key={i} data-testid="md-block" data-block-kind={b.kind} data-block-index={i}
            className="group/block relative rounded transition-colors hover:bg-sky-50/40 dark:hover:bg-sky-950/20">
            <MarkdownRenderer bare content={b.text} docPath={docPath} onNavigate={onNavigate} highlight={highlight} />
            <button type="button" data-testid="md-block-edit" onClick={() => startEdit(i)}
              aria-label={`编辑${label}第 ${i + 1} 块（原始 Markdown）`} title="编辑这一块"
              className="absolute right-0 top-0 -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted opacity-0 transition-opacity hover:border-sky-400 hover:text-sky-600 focus-visible:opacity-100 group-hover/block:opacity-100">
              <span className="inline-flex items-center gap-1"><Pencil className="h-3 w-3" />编辑</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

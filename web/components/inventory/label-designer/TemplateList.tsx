"use client";

import { Plus, Save, Star, Trash2 } from "lucide-react";
import type { LabelTemplate } from "@/lib/labelTemplate";

interface Props {
  templates: LabelTemplate[];
  currentId: number;
  dirty: boolean;
  notice: { kind: "info" | "error" | "ok"; text: string } | null;
  onSelect: (t: LabelTemplate) => void;
  onCreate: () => void;
  onSave: () => void;
  onDelete: (id: number) => void;
  onSetDefault: (id: number) => void;
}

/** 模板列表 + 新建/保存/删除/设为默认（默认模板有唯一标识） */
export function TemplateList({ templates, currentId, dirty, notice, onSelect, onCreate, onSave, onDelete, onSetDefault }: Props) {
  const btn = "inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-surface-hover disabled:opacity-50";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        <button type="button" data-testid="template-new" onClick={onCreate} className={btn}><Plus className="h-3 w-3" />新建</button>
        <button type="button" data-testid="template-save" onClick={onSave} disabled={!dirty} className={btn}><Save className="h-3 w-3" />保存{dirty ? " *" : ""}</button>
        <button type="button" data-testid="template-delete" onClick={() => onDelete(currentId)} disabled={templates.length <= 1} className={`${btn} text-danger`}>
          <Trash2 className="h-3 w-3" />删除
        </button>
      </div>

      {notice && (
        <p data-testid="templates-notice"
          className={`rounded-lg border-l-4 px-2 py-1.5 text-[11px] ${notice.kind === "error" ? "border-danger bg-red-50 text-red-700" : notice.kind === "ok" ? "border-success bg-emerald-50 text-emerald-700" : "border-warning bg-amber-50 text-amber-800"}`}>
          {notice.text}
        </p>
      )}

      <ul className="space-y-1">
        {templates.map(t => (
          <li key={t.id}>
            <div data-testid="template-item" data-template-id={t.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${t.id === currentId ? "border-primary bg-primary/5" : "border-border hover:bg-surface-hover"}`}>
              <button type="button" onClick={() => onSelect(t)} className="min-w-0 flex-1 truncate text-left">
                {t.name}
              </button>
              <span data-testid="kind-badge" className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted">
                {(t.kind ?? "material") === "location" ? "库位" : "物料"}
              </span>
              {t.isDefault && (
                <span data-testid="default-badge" title="默认模板（导出默认用它）"
                  className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">默认</span>
              )}
              <button type="button" data-testid={`template-set-default-${t.id}`} onClick={() => onSetDefault(t.id)}
                aria-label={`把「${t.name}」设为默认`} title="设为默认"
                className="shrink-0 rounded p-1 text-muted hover:text-primary disabled:opacity-40" disabled={t.isDefault === true}>
                <Star className="h-3 w-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-faint">模板是全队共用的打印规范；只有管理员能改。</p>
    </div>
  );
}

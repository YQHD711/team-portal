"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Plus, RotateCcw } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks";
import { DEFAULT_TEMPLATE } from "@/lib/labelTemplate";
import { useLabelDesigner } from "@/components/inventory/label-designer/useLabelDesigner";
import { LabelCanvas } from "@/components/inventory/label-designer/LabelCanvas";
import { ElementPanel } from "@/components/inventory/label-designer/ElementPanel";
import { TemplateList } from "@/components/inventory/label-designer/TemplateList";

/**
 * 标签模板设计器（**仅管理员**）：拖拽/缩放元素、改页面与文字样式、实时预览、模板 CRUD/设默认。
 * 预览用的是导出那套 renderLabelPng（见 LabelCanvas），没有第二份绘制逻辑。
 */
export default function LabelTemplatesPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const d = useLabelDesigner({ enabled: isAdmin });

  if (userLoading) return <div className="p-8 text-sm text-faint">加载中…</div>;
  if (!isAdmin) {
    return (
      <div data-testid="not-admin" className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted">标签模板只允许管理员维护。</p>
        <Link href="/inventory/layout" className="mt-3 inline-block text-xs text-sky-600 hover:underline">返回物料布局</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/inventory/layout" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />物料布局
        </Link>
        <h1 className="text-xl font-bold">标签模板</h1>
        <span className="text-xs text-faint">拖拽移动 · 拖角缩放 · 吸附 0.5mm · 越界自动夹回</span>
        {d.dirty && <span data-testid="dirty-hint" className="text-xs text-amber-600">有未保存改动</span>}
        {d.loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
        <aside data-testid="template-list" className="rounded-xl border border-border bg-surface p-3">
          <TemplateList templates={d.templates} currentId={d.template.id} dirty={d.dirty} notice={d.notice}
            onSelect={d.selectTemplate} onCreate={() => void d.create()} onSave={() => void d.save()}
            onDelete={id => void d.remove(id)} onSetDefault={id => void d.makeDefault(id)} />
        </aside>

        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="add-qr" onClick={() => d.addElement("qr")}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-hover">
              <Plus className="h-3 w-3" />二维码
            </button>
            <button type="button" data-testid="add-text" onClick={() => d.addElement("text")}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-hover">
              <Plus className="h-3 w-3" />文本框
            </button>
            <button type="button" data-testid="reset-template" onClick={() => d.selectTemplate(DEFAULT_TEMPLATE)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-surface-hover">
              <RotateCcw className="h-3 w-3" />重置为内置默认
            </button>
          </div>

          <div className="overflow-auto">
            <LabelCanvas template={d.template} selectedId={d.selectedId}
              onSelect={d.setSelectedId} onChange={d.setElementRect} />
          </div>

          <p className="text-[11px] text-faint">
            预览用的是示例物料（{d.template.elements.length} 个元素）—— 与「导出 PDF」走同一套渲染函数。
          </p>
        </section>

        <aside data-testid="element-panel" className="rounded-xl border border-border bg-surface p-3">
          <ElementPanel template={d.template} selected={d.selected} onPatchTemplate={d.patchTemplate}
            onPatchElement={d.patchElement} onDuplicate={d.duplicateElement} onDelete={d.deleteElement} />
        </aside>
      </div>
    </div>
  );
}

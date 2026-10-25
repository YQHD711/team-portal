"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { DEFAULT_TEMPLATE, normalizeTemplates, type LabelData, type LabelTemplate } from "@/lib/labelTemplate";
import { LOCATION_FALLBACK_TEMPLATE } from "@/lib/locationTemplate";
import { resolveLocationExportTemplate, unwrapTemplates } from "@/lib/labelSuitability";
import NiimbotPrintPanel from "./NiimbotPrintPanel";

interface Props {
  title: string;
  /** 每项 = 一张标签（物料或库位） */
  dataList: LabelData[];
  /** material：用物料模板接口的默认模板；location：走 resolveLocationExportTemplate（kind=location） */
  kind?: "material" | "location";
  /** 库位批量时被跳过的空库位数（仅展示） */
  skipped?: number;
  onClose: () => void;
}

/**
 * 批量直连打印弹窗（物料多选 / 房间或元素的库位标签）。
 * 仅部长与管理员可达（入口本身已按角色不渲染）。
 */
export default function BatchLabelPrintModal({ title, dataList, kind = "material", skipped = 0, onClose }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([
    kind === "location" ? LOCATION_FALLBACK_TEMPLATE : DEFAULT_TEMPLATE,
  ]);
  const [templateId, setTemplateId] = useState<number>(
    kind === "location" ? LOCATION_FALLBACK_TEMPLATE.id : DEFAULT_TEMPLATE.id,
  );
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>("/api/label-templates")
      .then(raw => {
        if (cancelled) return;
        if (kind === "location") {
          const pick = resolveLocationExportTemplate(unwrapTemplates(raw));
          setTemplates([pick.template]);
          setTemplateId(pick.template.id);
          if (pick.notice) setNotice(pick.notice);
          return;
        }
        const list = normalizeTemplates(raw);
        if (list.length === 0) return;
        setTemplates(list);
        setTemplateId((list.find(t => t.isDefault) ?? list[0]).id);
      })
      .catch(() => {
        if (cancelled || kind !== "location") return;
        const pick = resolveLocationExportTemplate([]);
        setTemplates([pick.template]);
        setTemplateId(pick.template.id);
        if (pick.notice) setNotice(pick.notice);
      });
    return () => { cancelled = true; };
  }, [kind]);

  const selectedTemplate = templates.find(t => t.id === templateId) ?? templates[0]
    ?? (kind === "location" ? LOCATION_FALLBACK_TEMPLATE : DEFAULT_TEMPLATE);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div data-testid="batch-label-print-modal"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            <p data-testid="batch-label-count" className="mt-0.5 text-xs text-muted">
              共 {dataList.length} 张 · 每张份数在下方设置
              {skipped > 0 ? ` · 跳过 ${skipped} 个未指定库位` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
          {notice && <p data-testid="batch-label-notice" className="text-[11px] text-muted">{notice}</p>}
          {kind === "material" ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              标签模板
              <select data-testid="batch-label-template-select" value={selectedTemplate.id}
                onChange={e => setTemplateId(Number(e.target.value))}
                className="min-h-10 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.isDefault ? "（默认）" : ""}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-muted">库位模板：<span className="font-medium">{selectedTemplate.name}</span></p>
          )}

          <NiimbotPrintPanel template={selectedTemplate} dataList={dataList} />
        </div>
      </div>
    </div>
  );
}

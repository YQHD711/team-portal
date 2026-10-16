"use client";

/**
 * **房间级**批量导出库位标签（task-40 ② 的第一半——真实用法："贴一整屋"）。
 *
 * 行为：收集本屋**所有元素的全部真实格位编码**（元素未分格时用它自己的码；未指定库位的一律跳过并计数），
 * 导出前 `confirm` 显示 `describeBatch`（N 张 / 跳过 M / >200 提醒），确认后生成**多页 PDF**并下载，
 * 文件名 `房间名-库位标签-YYYY-MM-DD.pdf`。
 *
 * 复用：`elementCells`（既有几何）+ `buildLocationLabelsPdf`（既有 PDF 能力，含模板驱动页面尺寸）。
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ItemElement, RoomLayout } from "./layoutTypes";
import { usesCells } from "./layoutTypes";
import { elementCells } from "./elementGeometry";
import { DEFAULT_TEMPLATE, type LabelTemplate } from "@/lib/labelTemplate";
import { chooseExportTemplate } from "@/lib/labelSuitability";
import {
  buildLocationLabelsPdf, collectLocationSlots, describeBatch, downloadPdf, labelFileName,
} from "@/lib/locationLabelPdf";

interface Props {
  layout: RoomLayout;
  roomName: string;
  /** 覆盖模板（测试用）；不传则取**团队默认模板**，取不到降级用内置默认 */
  template?: LabelTemplate;
}

/** 本屋所有真实格位编码（未指定库位的元素不产出编码） */
export function roomLocationCodes(items: readonly ItemElement[]): { name: string; codes: string[] }[] {
  return items.map(el => {
    if (!el.locCode?.trim()) return { name: el.name, codes: [] };          // 未指定库位 → 无编码
    const codes = usesCells(el) ? elementCells(el).map(c => c.code).filter(Boolean) : [el.locCode];
    return { name: el.name, codes };
  });
}

export function ExportLocationLabelsButton({ layout, roomName, template: override }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // 团队默认模板（管理员可在设计器里改尺寸）→ 导出页面尺寸随之变化；接口不可用时**降级**用内置默认（不阻塞导出）
  const [template, setTemplate] = useState<LabelTemplate>(override ?? DEFAULT_TEMPLATE);
  useEffect(() => {
    if (override) return;
    api.get<LabelTemplate[]>("/api/label-templates")
      .then(list => {
        const pick = chooseExportTemplate(list.find(t => t.isDefault) ?? list[0] ?? null);
        setTemplate(pick.template);
        if (pick.notice) setMsg(pick.notice);   // **不静默**：说明为什么换了模板
      })
      .catch(() => { const pick = chooseExportTemplate(null); setTemplate(pick.template); if (pick.notice) setMsg(pick.notice); });
  }, [override]);

  const onClick = async () => {
    const { slots, skipped } = collectLocationSlots(roomLocationCodes(layout.items), roomName);
    if (slots.length === 0) { setMsg("本屋没有可导出的库位（都未指定库位）"); return; }
    if (!confirm(describeBatch(slots, skipped))) return;
    setBusy(true);
    setMsg("正在生成 PDF…");
    try {
      const bytes = await buildLocationLabelsPdf(slots, template);
      downloadPdf(bytes, labelFileName(roomName));
      setMsg(`已导出 ${slots.length} 张库位标签（跳过 ${skipped} 个未指定库位）`);
    } catch (err) {
      setMsg(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" data-testid="export-location-labels" onClick={onClick} disabled={busy}
        title="把本屋所有库位编码导出成一个多页 PDF（每页一张标签，可直接送标签机）"
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-hover disabled:opacity-60">
        导出本屋库位标签
      </button>
      {msg && <span data-testid="export-location-labels-msg" className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}

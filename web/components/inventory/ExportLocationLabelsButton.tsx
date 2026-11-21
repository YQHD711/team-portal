"use client";

/**
 * **房间级**库位标签打印（原"导出 PDF"已移除：全系统不再提供导出，统一走打印机）。
 *
 * 行为：收集本屋所有元素的全部真实格位编码（元素未分格时用它自己的码；未指定库位的一律跳过并计数），
 * 打印前 confirm 显示 describeBatch（N 张 / 跳过 M / >200 提醒），确认后把整批送打印机。
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ItemElement, RoomLayout } from "./layoutTypes";
import { usesCells } from "./layoutTypes";
import { elementCells } from "./elementGeometry";
import type { LabelTemplate } from "@/lib/labelTemplate";
import { LOCATION_FALLBACK_TEMPLATE } from "@/lib/locationTemplate";
import { resolveLocationExportTemplate, unwrapTemplates, type LabelTemplatesResponse } from "@/lib/labelSuitability";
import { collectLocationSlots, describeBatch, toLocationLabelData } from "@/lib/locationLabelPdf";
import { useCurrentUser } from "@/lib/hooks";
import type { LabelData } from "@/lib/labelTemplate";
import BatchLabelPrintModal from "./BatchLabelPrintModal";
import { Printer } from "lucide-react";

interface Props {
  layout: RoomLayout;
  roomName: string;
  /** 覆盖模板（测试用）；不传则取团队默认模板，取不到降级用内置默认 */
  template?: LabelTemplate;
}

/** 本屋所有真实格位编码（未指定库位的元素不产出编码） */
export function roomLocationCodes(items: readonly ItemElement[]): { name: string; codes: string[] }[] {
  return items.map(el => {
    if (!el.locCode?.trim()) return { name: el.name, codes: [] };
    const codes = usesCells(el) ? elementCells(el).map(c => c.code).filter(Boolean) : [el.locCode];
    return { name: el.name, codes };
  });
}

export function ExportLocationLabelsButton({ layout, roomName, template: override }: Props) {
  const [msg, setMsg] = useState("");
  /** 直连打印仅部长/管理员 */
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const [printData, setPrintData] = useState<{ dataList: LabelData[]; skipped: number } | null>(null);
  // 初始值就是内置库位模板（无二维码）：接口还没回来/失败时也不会误用带二维码的物料模板
  const [template, setTemplate] = useState<LabelTemplate>(override ?? LOCATION_FALLBACK_TEMPLATE);
  useEffect(() => {
    if (override) return;
    api.get<LabelTemplatesResponse>("/api/label-templates")
      .then(list => {
        const pick = resolveLocationExportTemplate(unwrapTemplates(list));
        setTemplate(pick.template);
        if (pick.notice) setMsg(pick.notice);   // 不静默：说明用了哪个模板、为什么
      })
      .catch(() => {
        const pick = resolveLocationExportTemplate([]);
        setTemplate(pick.template);
        if (pick.notice) setMsg(pick.notice);
      });
  }, [override]);

  /** 直连打印：收集本屋全部库位编码 → 连续送打印机 */
  const onDirectPrint = () => {
    const { slots, skipped } = collectLocationSlots(roomLocationCodes(layout.items), roomName);
    if (slots.length === 0) { setMsg("本屋没有可打印的库位（都未指定库位）"); return; }
    if (!confirm(describeBatch(slots, skipped))) return;
    setPrintData({ dataList: slots.map(toLocationLabelData), skipped });
  };

  if (!isStaff) {
    return msg ? <span className="text-[11px] text-muted">{msg}</span> : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-testid="direct-print-location-labels" onClick={onDirectPrint}
        title="用精臣 K3W 连续打印本屋全部库位标签（仅部长/管理员）"
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-hover">
        <Printer className="h-3.5 w-3.5" />打印本屋库位标签
      </button>
      {msg && <span data-testid="export-location-labels-msg" className="text-[11px] text-muted">{msg}</span>}
      {printData && (
        <BatchLabelPrintModal
          title={"打印本屋库位标签（" + printData.dataList.length + " 张）"}
          dataList={printData.dataList} kind="location" skipped={printData.skipped}
          onClose={() => setPrintData(null)} />
      )}
    </div>
  );
}

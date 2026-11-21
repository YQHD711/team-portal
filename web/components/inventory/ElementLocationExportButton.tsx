"use client";

/**
 * 单个元素的库位标签打印（系统不再提供导出 PDF，只走直连打印）。
 *
 * 行为：展开该元素的全部真实格位码（分格元素 → 每格一个码，含桌下；未分格 → 用它自己的码），
 * confirm(describeBatch) 后把整批送打印机（精臣 K3W）。
 */

import { useEffect, useState } from "react";
import type { ItemElement } from "./layoutTypes";
import { api } from "@/lib/api";
import type { LabelTemplate } from "@/lib/labelTemplate";
import { LOCATION_FALLBACK_TEMPLATE } from "@/lib/locationTemplate";
import { resolveLocationExportTemplate, unwrapTemplates, type LabelTemplatesResponse } from "@/lib/labelSuitability";
import { collectLocationSlots, describeBatch, toLocationLabelData } from "@/lib/locationLabelPdf";
import { useCurrentUser } from "@/lib/hooks";
import type { LabelData } from "@/lib/labelTemplate";
import { roomLocationCodes } from "./ExportLocationLabelsButton";
import BatchLabelPrintModal from "./BatchLabelPrintModal";
import { Printer } from "lucide-react";

interface Props {
  element: ItemElement;
  roomName: string;
  template?: LabelTemplate;
}

export function ElementLocationExportButton({ element, roomName }: Props) {
  const [msg, setMsg] = useState("");
  /** 直连打印仅部长/管理员 */
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const [printData, setPrintData] = useState<{ dataList: LabelData[]; skipped: number } | null>(null);
  // 初始值 = 内置库位模板（无二维码）：接口未回来/失败时也不会误用带二维码的物料模板
  const [template, setTemplate] = useState<LabelTemplate>(LOCATION_FALLBACK_TEMPLATE);

  useEffect(() => {
    api.get<LabelTemplatesResponse>("/api/label-templates")
      .then(list => {
        const pick = resolveLocationExportTemplate(unwrapTemplates(list));
        setTemplate(pick.template);
        if (pick.notice) setMsg(pick.notice);
      })
      .catch(() => {
        const pick = resolveLocationExportTemplate([]);
        setTemplate(pick.template);
        if (pick.notice) setMsg(pick.notice);
      });
  }, []);

  const onDirectPrint = () => {
    const { slots, skipped } = collectLocationSlots(roomLocationCodes([element]), roomName);
    if (slots.length === 0) { setMsg("该元素未指定库位，无可打印的库位标签"); return; }
    if (!confirm(describeBatch(slots, skipped))) return;
    setPrintData({ dataList: slots.map(toLocationLabelData), skipped });
  };

  if (!isStaff) {
    return msg ? <span className="text-[11px] text-muted">{msg}</span> : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-testid="direct-print-element-loc-labels" onClick={onDirectPrint}
        title="用精臣 K3W 连续打印本元素全部格位的库位标签（仅部长/管理员）"
        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15">
        <Printer className="h-3.5 w-3.5" />打印本元素库位标签
      </button>
      {msg && <span data-testid="export-element-loc-labels-msg" className="text-[11px] text-muted">{msg}</span>}
      {printData && (
        <BatchLabelPrintModal
          title={"打印本元素库位标签（" + printData.dataList.length + " 张）"}
          dataList={printData.dataList} kind="location" skipped={printData.skipped}
          onClose={() => setPrintData(null)} />
      )}
    </div>
  );
}

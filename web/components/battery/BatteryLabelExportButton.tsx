"use client";

/** 批量打印电池二维码标签（精臣 K3W 直连）。系统不再提供导出 PDF。 */
import { useState } from "react";
import { Printer } from "lucide-react";
import type { LabelTemplate, LabelData } from "@/lib/labelTemplate";
import { toBatteryLabelData, type BatteryLabelSource } from "@/lib/batteryLabelPdf";
import BatchLabelPrintModal from "../inventory/BatchLabelPrintModal";

interface Props {
  /** 要打印标签的电池（通常是当前筛选结果） */
  batteries: readonly BatteryLabelSource[];
  /** 测试/自定义入口；不传则用团队默认模板 */
  template?: LabelTemplate;
}

export function BatteryLabelExportButton({ batteries }: Props) {
  const [printData, setPrintData] = useState<LabelData[] | null>(null);

  const onPrint = () => {
    if (batteries.length === 0) return;
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    setPrintData(batteries.map(b => toBatteryLabelData(b, origin)));
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrint}
        disabled={batteries.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
        title="用精臣 K3W 连续打印当前列表的电池二维码标签"
      >
        <Printer className="h-4 w-4" />
        打印标签
      </button>
      {printData && (
        <BatchLabelPrintModal
          title={"打印电池标签（" + printData.length + " 张）"}
          dataList={printData} kind="material"
          onClose={() => setPrintData(null)} />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Loader2, Printer } from "lucide-react";
import type { LabelTemplate } from "@/lib/labelTemplate";
import { DEFAULT_TEMPLATE } from "@/lib/labelTemplate";
import { unwrapTemplates, type LabelTemplatesResponse } from "@/lib/labelSuitability";
import { downloadPdf, progressText } from "@/lib/locationLabelPdf";
import {
  batteryLabelFileName, buildBatteryLabelsPdf, pickMaterialTemplate, type BatteryLabelSource,
} from "@/lib/batteryLabelPdf";

interface Props {
  /** 要导出标签的电池（通常是当前筛选结果） */
  batteries: readonly BatteryLabelSource[];
  /** 测试/自定义入口；不传则取团队物料默认模板 */
  template?: LabelTemplate;
}

/** 批量导出电池二维码标签 PDF（每块一张，二维码指向 /b/<code>）。 */
export function BatteryLabelExportButton({ batteries, template: override }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const onClick = async () => {
    if (batteries.length === 0) { setMsg("当前没有可导出的电池"); return; }
    if (typeof confirm === "function" && !confirm(`将导出 ${batteries.length} 张电池标签，继续？`)) return;

    setBusy(true);
    setMsg("正在准备标签模板…");
    try {
      let template = override ?? null;
      if (!template) {
        try {
          const list = unwrapTemplates(await api.get<LabelTemplatesResponse>("/api/label-templates"));
          template = pickMaterialTemplate(list);
        } catch {
          // 模板接口不可用：回落到内置默认模板（导出不能因此不可用）
        }
      }
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      const bytes = await buildBatteryLabelsPdf(batteries, origin, template ?? DEFAULT_TEMPLATE, {
        onProgress: (done, total) => setMsg(progressText(done, total)),
      });
      downloadPdf(bytes, batteryLabelFileName());
      setMsg(`已导出 ${batteries.length} 张电池标签`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={busy || batteries.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
        title="导出当前列表的电池二维码标签（PDF）"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        导出标签
      </button>
      {msg && <span className="text-xs text-faint">{msg}</span>}
    </div>
  );
}

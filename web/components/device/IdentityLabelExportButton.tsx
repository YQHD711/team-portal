"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Loader2, Printer } from "lucide-react";
import type { LabelTemplate } from "@/lib/labelTemplate";
import { DEFAULT_TEMPLATE } from "@/lib/labelTemplate";
import { unwrapTemplates, type LabelTemplatesResponse } from "@/lib/labelSuitability";
import { progressText } from "@/lib/locationLabelPdf";
import { exportLabelsPdf, pickMaterialTemplate } from "@/lib/printService";
import { toIdentityLabelData, type IdentityLabelSource } from "@/lib/identityLabelPdf";

interface Props {
  /** 要印身份码的队员（通常是当前可见用户） */
  people: readonly IdentityLabelSource[];
  /** 测试/自定义入口；不传则取团队物料默认模板 */
  template?: LabelTemplate;
}

/** 批量导出身份码 PDF（每人一张工牌二维码，内容 /u/{slug} 或学号）。 */
export function IdentityLabelExportButton({ people, template: override }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const onClick = async () => {
    if (people.length === 0) { setMsg("当前没有可导出的队员"); return; }
    if (typeof confirm === "function" && !confirm("将导出 " + people.length + " 张身份码，继续？")) return;

    setBusy(true);
    setMsg("正在准备标签模板…");
    try {
      let template = override ?? null;
      if (!template) {
        try {
          const list = unwrapTemplates(await api.get<LabelTemplatesResponse>("/api/label-templates"));
          template = pickMaterialTemplate(list);
        } catch {
          // 模板接口不可用：回落内置默认（导出不能因此不可用）
        }
      }
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      const dataList = people.map(p => toIdentityLabelData(p, origin));
      await exportLabelsPdf("identity", dataList, template ?? DEFAULT_TEMPLATE, {
        onProgress: (done, total) => setMsg(progressText(done, total)),
      });
      setMsg("已导出 " + people.length + " 张身份码");
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
        disabled={busy || people.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
        title="批量导出队员身份码（工牌二维码 PDF）"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        导出身份码
      </button>
      {msg && <span className="text-xs text-faint">{msg}</span>}
    </div>
  );
}

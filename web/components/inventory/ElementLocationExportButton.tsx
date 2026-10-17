"use client";

/**
 * **单个元素的库位标签导出**（task-40 ③a，用户原话要的核心用法）。
 *
 * 行为：展开该元素的**全部真实格位码**（分格元素 → 每格一个码，含桌下；未分格 → 用它自己的码；
 * 未指定库位 → 跳过并计数）→ `confirm(describeBatch)` → 模板适用性守卫 → **矢量路径生成**（中文可读）→
 * 下载 `房间-元素名-库位标签-日期.pdf`。
 *
 * 复用：`roomLocationCodes`（与房间级入口同一取码逻辑，**不重复实现**）、`collectLocationSlots`、
 * `describeBatch`、`downloadPdf`、`chooseExportTemplate`、`findUnscannableCodes`、`buildLocationLabelsVectorPdf`。
 */

import { useEffect, useRef, useState } from "react";
import type { ItemElement } from "./layoutTypes";
import { api } from "@/lib/api";
import type { LabelTemplate } from "@/lib/labelTemplate";
import { LOCATION_FALLBACK_TEMPLATE } from "@/lib/locationTemplate";
import { resolveLocationExportTemplate, unwrapTemplates, type LabelTemplatesResponse } from "@/lib/labelSuitability";
import { collectLocationSlots, describeBatch, downloadPdf, elementLabelFileName } from "@/lib/locationLabelPdf";
import { buildLocationLabelsVectorPdf, findUnscannableCodes, unscannableWarning } from "@/lib/locationLabelVector";
import { roomLocationCodes } from "./ExportLocationLabelsButton";

interface Props {
  element: ItemElement;
  roomName: string;
  template?: LabelTemplate;
}

export function ElementLocationExportButton({ element, roomName, template: override }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // 初始值 = 内置**库位**模板（无二维码）：接口未回来/失败时也不会误用带二维码的物料模板
  const [template, setTemplate] = useState<LabelTemplate>(override ?? LOCATION_FALLBACK_TEMPLATE);
  const lastProgressAt = useRef(0);

  useEffect(() => {
    if (override) return;
    api.get<LabelTemplatesResponse>("/api/label-templates")
      .then(list => { const pick = resolveLocationExportTemplate(unwrapTemplates(list)); setTemplate(pick.template); if (pick.notice) setMsg(pick.notice); })
      .catch(() => { const pick = resolveLocationExportTemplate([]); setTemplate(pick.template); if (pick.notice) setMsg(pick.notice); });
  }, [override]);

  const onClick = async () => {
    const { slots, skipped } = collectLocationSlots(roomLocationCodes([element]), roomName);
    if (slots.length === 0) { setMsg("该元素未指定库位，无可导出的库位标签"); return; }
    if (!confirm(describeBatch(slots, skipped))) return;
    setBusy(true);
    setMsg("正在准备生成组件…");
    try {
      const bad = await findUnscannableCodes(slots, template).catch(() => [] as string[]);
      if (bad.length > 0 && !confirm(unscannableWarning(bad, template))) { setBusy(false); setMsg("已取消导出"); return; }
      const bytes = await buildLocationLabelsVectorPdf(slots, template, {
        onProgress: (done, total) => {
          const now = Date.now();
          if (done < total && now - lastProgressAt.current < 250) return;
          lastProgressAt.current = now;
          setMsg(`正在生成 ${done}/${total}…`);
        },
      });
      downloadPdf(bytes, elementLabelFileName(roomName, element.name));
      setMsg(`已导出 ${slots.length} 张（跳过 ${skipped} 个未指定库位）`);
    } catch (err) {
      setMsg(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" data-testid="export-element-loc-labels" onClick={onClick} disabled={busy}
        title="导出本元素全部格位的库位标签（每格一张，可直接送标签机）"
        className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-subtle disabled:opacity-60">
        导出本元素库位标签
      </button>
      {msg && <span data-testid="export-element-loc-labels-msg" className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}

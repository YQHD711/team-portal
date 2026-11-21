"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { X, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";
import { DEFAULT_TEMPLATE, normalizeTemplates, type LabelData, type LabelTemplate } from "@/lib/labelTemplate";
import type { InventoryItem } from "./inventoryTypes";
import { toMaterialLabelData } from "./batchLabelData";
import NiimbotPrintPanel from "./NiimbotPrintPanel";

interface Props {
  item: InventoryItem;
  /** 短链对外地址（后端 App:PublicBaseUrl 下发）；短链 = {baseUrl}/i/{编码} */
  baseUrl: string;
  /** 地址看起来是 localhost/回环 —— 印出去队员扫不开，打印前要提醒 */
  baseLooksLocal?: boolean;
  /** 直连打印仅部长/管理员可用；缺省 true 便于组件级测试 */
  canDirectPrint?: boolean;
  onClose: () => void;
}

/**
 * 实物标签：二维码 + 可读编码 + 名称 + 库位 + 等级。
 *
 * 只保留**直连打印**（精臣 K3W）：系统不再提供导出 PDF，也不再走浏览器打印。
 * 二维码内容是短链 {baseUrl}/i/{编码}，同时印可读编码供扫码枪/手输兜底。
 */
export default function ItemLabelModal({ item, baseUrl, baseLooksLocal, canDirectPrint = true, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState<LabelTemplate[]>([DEFAULT_TEMPLATE]);
  const [templateId, setTemplateId] = useState<number>(DEFAULT_TEMPLATE.id);
  const labelData: LabelData = toMaterialLabelData(item, baseUrl);
  const code = labelData.code;
  const url = labelData.url;
  const selectedTemplate = templates.find(t => t.id === templateId) ?? templates[0] ?? DEFAULT_TEMPLATE;

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>("/api/label-templates")
      .then(raw => {
        if (cancelled) return;
        const list = normalizeTemplates(raw);
        if (list.length === 0) return;
        setTemplates(list);
        setTemplateId((list.find(t => t.isDefault) ?? list[0]).id);
      })
      .catch(() => { /* 接口不可用：用内置模板打印 */ });
    return () => { cancelled = true; };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div data-testid="item-label-modal"
        className="flex max-h-[90dvh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl md:max-w-2xl lg:max-w-3xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 sm:px-6">
          <h2 className="text-lg font-bold">物料标签</h2>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-surface-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
          {baseLooksLocal && (
            <p data-testid="local-base-warning" className="mb-3 rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠️ 短链用的是本机地址（{baseUrl}），<strong>队员手机扫不开</strong>。请到「系统设置」把「对外访问地址」设成大家实际访问的地址后重印。
            </p>
          )}

          <div data-testid="label-layout-grid" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start lg:gap-6">
            <section data-testid="label-preview-column" className="flex min-w-0 flex-col items-center gap-3 text-center">
              <div className="rounded-lg bg-white p-2">
                <QRCode value={url} size={148} level="M" />
              </div>
              <div className="font-mono text-base font-bold tracking-wide break-all">{code}</div>
              <div className="text-sm font-medium break-words">{item.name}</div>
              <div className="text-xs text-muted">
                {item.grade} 级 · {item.locationCode || "库位未指定"} · {item.category || "未分类"}
              </div>
              <div className="w-full break-all text-[10px] text-faint">{url}</div>

              <label className="mt-1 flex w-full flex-col gap-1 text-left text-xs text-muted">
                标签模板
                <select data-testid="label-template-select" value={selectedTemplate.id}
                  onChange={e => setTemplateId(Number(e.target.value))}
                  className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.isDefault ? "（默认）" : ""}</option>
                  ))}
                </select>
              </label>
            </section>

            <section data-testid="label-actions-column" className="flex min-w-0 flex-col gap-3 lg:border-l lg:border-border lg:pl-6">
              {canDirectPrint ? (
                <NiimbotPrintPanel template={selectedTemplate} dataList={[labelData]} />
              ) : (
                <p className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-muted">
                  直连打印仅部长/管理员可用。
                </p>
              )}

              <div data-testid="label-action-buttons" className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void copy()} aria-label="复制短链"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                  {copied ? <><Check className="h-4 w-4 text-success" />已复制</> : <><Copy className="h-4 w-4" />复制短链</>}
                </button>
                <button type="button" onClick={onClose}
                  className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                  关闭
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

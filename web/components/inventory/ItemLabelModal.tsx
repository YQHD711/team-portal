"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Printer, X, Copy, Check, FileDown } from "lucide-react";
import type { InventoryItem } from "./inventoryTypes";

interface Props {
  item: InventoryItem;
  /** 短链对外地址（后端 App:PublicBaseUrl 下发）；短链 = {baseUrl}/i/{编码} */
  baseUrl: string;
  /** 地址看起来是 localhost/回环 —— 印出去队员扫不开，打印前要提醒 */
  baseLooksLocal?: boolean;
  onClose: () => void;
}

/**
 * 实物标签：二维码 + 可读编码 + 名称 + 库位 + 等级。
 *
 * 二维码内容是**短链** `{baseUrl}/i/{编码}`（规范 §6.3），扫码直接进系统看这件物料；
 * 同时必须印可读编码——扫码枪坏了或标签磨损时靠它手输兜底。
 *
 * baseUrl 由后端下发而不是取 window.location.origin：管理员完全可能用 localhost
 * 打开系统去打印标签，那样印出来的二维码队员手机根本扫不开。
 */
export default function ItemLabelModal({ item, baseUrl, baseLooksLocal, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const code = item.code ?? "";
  const url = `${baseUrl.replace(/\/+$/, "")}/i/${encodeURIComponent(code)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 非安全上下文/未授权时剪贴板不可用，界面上仍能看到完整短链可手动选
      setCopied(false);
    }
  };

  /**
   * 导出 80×50mm 标签 PDF（对齐精臣软件里的 T80*50-560白 标签），拿 PDF 去打印。
   * 与「打印」是两条独立路径：这个按钮不打开打印对话框。
   * labelPdf / jsPDF 都在点击时才下载，不进主包。
   */
  const exportPdf = async () => {
    if (!code || exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const { exportLabelPdf } = await import("@/lib/labelPdf");
      await exportLabelPdf({
        code, url, name: item.name,
        grade: item.grade, locationCode: item.locationCode, category: item.category,
      });
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm print:static print:bg-white print:p-0" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl print:border-0 print:shadow-none" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h2 className="text-lg font-bold">物料标签</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>

        {baseLooksLocal && (
          <p data-testid="local-base-warning" className="mb-3 rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 print:hidden">
            ⚠️ 短链用的是本机地址（{baseUrl}），<strong>队员手机扫不开</strong>。请到「系统设置」把「对外访问地址」设成大家实际访问的地址后重印。
          </p>
        )}

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-lg bg-white p-2">
            <QRCode value={url} size={148} level="M" />
          </div>
          <div className="font-mono text-base font-bold tracking-wide">{code}</div>
          <div className="text-sm font-medium">{item.name}</div>
          <div className="text-xs text-muted">
            {item.grade} 级 · {item.locationCode || "库位未指定"} · {item.category || "未分类"}
          </div>
          <div className="break-all text-[10px] text-faint">{url}</div>
        </div>

        {exportFailed && (
          <p data-testid="export-pdf-error" className="mt-3 rounded-lg border-l-4 border-danger bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden">
            导出失败：浏览器可能不支持画布导出，请改用「打印」或换个浏览器（Chrome / Edge）。
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2 print:hidden">
          <button onClick={() => window.print()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Printer className="h-4 w-4" />打印
          </button>
          <button type="button" onClick={() => void exportPdf()} disabled={!code || exporting}
            data-testid="export-label-pdf"
            title={code ? "导出 80×50mm 标签 PDF，可用精臣软件或其他打印流程出纸" : "该物料没有编码，无法导出标签"}
            className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
            <FileDown className="h-4 w-4" />{exporting ? "导出中…" : "导出 PDF"}
          </button>
          <button onClick={() => void copy()} aria-label="复制短链"
            className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
            {copied ? <><Check className="h-4 w-4 text-success" />已复制</> : <><Copy className="h-4 w-4" />复制短链</>}
          </button>
          <button onClick={onClose} className="inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">关闭</button>
        </div>
      </div>
    </div>
  );
}

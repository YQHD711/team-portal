"use client";

import QRCode from "react-qr-code";
import { Printer, X } from "lucide-react";
import type { InventoryItem } from "./inventoryTypes";

interface Props {
  item: InventoryItem;
  /** 站点根地址，用来拼扫码短链 */
  origin: string;
  onClose: () => void;
}

/**
 * 实物标签：二维码 + 可读编码 + 名称 + 库位 + 等级。
 *
 * 二维码内容是**短链** `{origin}/i/{编码}`（规范 §6.3），扫码直接进系统看这件物料；
 * 同时必须印可读编码——扫码枪坏了或标签磨损时靠它手输兜底。
 */
export default function ItemLabelModal({ item, origin, onClose }: Props) {
  const code = item.code ?? "";
  const url = `${origin}/i/${encodeURIComponent(code)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm print:static print:bg-white print:p-0" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl print:border-0 print:shadow-none" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h2 className="text-lg font-bold">物料标签</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>

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

        <div className="mt-5 flex gap-2 print:hidden">
          <button onClick={() => window.print()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Printer className="h-4 w-4" />打印
          </button>
          <button onClick={onClose} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">关闭</button>
        </div>
      </div>
    </div>
  );
}

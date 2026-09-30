"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Printer, X, Copy, Check } from "lucide-react";
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

        <div className="mt-5 flex gap-2 print:hidden">
          <button onClick={() => window.print()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Printer className="h-4 w-4" />打印
          </button>
          <button onClick={() => void copy()} aria-label="复制短链"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
            {copied ? <><Check className="h-4 w-4 text-success" />已复制</> : <><Copy className="h-4 w-4" />复制短链</>}
          </button>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">关闭</button>
        </div>
      </div>
    </div>
  );
}

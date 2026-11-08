"use client";

import { Copy } from "lucide-react";

export interface SecretInfo {
  title: string;
  deviceName: string;
  deviceKey: string;
  secret: string;
}

interface Props {
  info: SecretInfo | null;
  onClose: () => void;
}

/** 设备密钥一次性展示弹窗：创建/重置后只出现这一次。 */
export function DeviceSecretModal({ info, onClose }: Props) {
  if (!info) return null;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* 非安全上下文忽略 */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-medium">{info.title} · {info.deviceName}</div>
        <p className="text-xs text-faint">Secret 只显示这一次，请立即复制到设备终端或密码管理器。</p>
        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-faint">DeviceKey</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-surface-hover p-2 text-xs">{info.deviceKey}</code>
              <button onClick={() => copy(info.deviceKey)} className="rounded border border-border p-1.5"><Copy className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-faint">Secret</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-surface-hover p-2 text-xs">{info.secret}</code>
              <button onClick={() => copy(info.secret)} className="rounded border border-border p-1.5"><Copy className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">我已保存</button>
        </div>
      </div>
    </div>
  );
}

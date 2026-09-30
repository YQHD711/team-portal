"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import QRCode from "react-qr-code";
import { ArrowLeft, Loader2, PackageX, MapPin, Package } from "lucide-react";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";

/**
 * 扫码短链落地页：/i/<物料编码>（规范 §6.3/§6.6）。
 *
 * 贴在实物上的二维码就指向这里，扫开直接看到"这是什么、在哪、还有几个"。
 * 大小写不敏感——标签磨损时手输不必纠结大小写。
 */
export default function ItemByCodePage() {
  const params = useParams();
  const router = useRouter();
  const raw = params.code;
  const code = decodeURIComponent(Array.isArray(raw) ? raw[0] : (raw ?? ""));

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!code) return;
    setUrl(`${window.location.origin}/i/${encodeURIComponent(code)}`);
    setLoading(true);
    api.get<InventoryItem>(`/api/inventory/by-code/${encodeURIComponent(code)}`)
      .then(setItem)
      .catch(() => { setItem(null); setNotFound(true); })
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  if (notFound || !item) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <PackageX className="mx-auto h-12 w-12 text-faint opacity-40" />
        <div>
          <h1 className="text-lg font-bold">没有找到这个编码</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono">{code}</span> 在库存里没有对应物料。
          </p>
          <p className="mt-2 text-xs text-faint">可能是标签印错了、物料已被删除，或编码还没录进系统。</p>
        </div>
        <button onClick={() => router.push("/inventory")} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
          去库存页手动查找
        </button>
      </div>
    );
  }

  const gradeCls = item.grade === "A"
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
    : item.grade === "B"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
      : "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <button onClick={() => router.push("/inventory")} className="inline-flex items-center gap-1 text-sm text-muted hover:text-zinc-700 dark:hover:text-zinc-300">
        <ArrowLeft className="h-4 w-4" />返回库存
      </button>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-sm text-faint">{item.code}</div>
            <h1 className="mt-1 text-xl font-bold">{item.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${gradeCls}`}>{item.grade} 级</span>
              <span className="text-muted">{item.category || "未分类"}</span>
            </div>
          </div>
          <div className="shrink-0 rounded-lg bg-white p-1.5">
            <QRCode value={url} size={92} level="M" />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-surface-subtle p-3">
            <dt className="text-xs text-muted">在库数量</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{item.quantity}</dd>
          </div>
          <div className="rounded-xl bg-surface-subtle p-3">
            <dt className="flex items-center gap-1 text-xs text-muted"><MapPin className="h-3.5 w-3.5" />库位</dt>
            <dd className="mt-1 font-mono text-sm">{item.locationCode || "未指定"}</dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Package className="h-3.5 w-3.5" />
          状态：{item.status === "available" ? "可用" : item.status === "in_use" ? "使用中（已借出）" : item.status === "broken" ? "损坏" : item.status}
        </div>
      </div>

      <p className="text-center text-xs text-faint">
        借出未还的部分不计入上面的数量；完整领用与操作记录见「领用管理」。
      </p>
    </div>
  );
}

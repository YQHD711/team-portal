"use client";

import { PackageOpen, Search } from "lucide-react";
import type { CheckoutReq } from "./checkoutTypes";

interface Props {
  items: CheckoutReq[];
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  onCheckin: (r: CheckoutReq) => void;
}

/** 借出天数：从批准时间（没有则按提交时间）算起，用于催办时一眼排优先级 */
function daysOut(r: CheckoutReq): number {
  const t = new Date(r.approvedAt || r.createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * 借出中：已批准但未归还的领用单。
 *
 * 之前只有「我的领用」和「待审批」，别人的 approved 单人谁也看不见，
 * 于是《物料管理规范》里"逾期由部长/管理员催办"这条流程没有入口。
 */
export default function OutstandingList({ items, loading, search, onSearch, onCheckin }: Props) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
        <input type="text" placeholder="按借用人或物料名搜索..." value={search}
          onChange={e => onSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-faint text-sm">加载中...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-faint">
            <PackageOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm">{search ? "没有匹配的借出记录" : "当前没有借出未还的物料"}</div>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {items.map(r => {
              const d = daysOut(r);
              return (
                <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-sm">{r.item?.name || `物料 #${r.inventoryItemId}`}</span>
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.grade === "A" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : r.grade === "B" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint"}`}>{r.grade}</span>
                      <span className="text-sm text-muted">× {r.quantity}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted flex items-center gap-2 flex-wrap">
                      <span>借用人：<strong className="text-zinc-700 dark:text-zinc-300">{r.requester?.username || "—"}</strong>
                        {r.requester?.department?.name ? `（${r.requester.department.name}）` : ""}</span>
                      <span className="text-faint">·</span>
                      <span>{new Date(r.approvedAt || r.createdAt).toLocaleDateString("zh-CN")} 借出</span>
                      <span className={`rounded px-1.5 py-0.5 ${d >= 14 ? "bg-warning/15 text-warning font-medium" : "text-faint"}`}>已借 {d} 天</span>
                    </div>
                    {r.note && <div className="mt-1 text-xs text-faint truncate">备注：{r.note}</div>}
                  </div>
                  <button onClick={() => onCheckin(r)}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">
                    归还
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

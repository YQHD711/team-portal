"use client";

import { displayName, formatTime, type BatteryLoan } from "./batteryTypes";

interface Props {
  loans: readonly BatteryLoan[];
}

/** 最近借还记录：借用人 / 归还人（支持甲借乙还的代还场景）。 */
export function RecentLoans({ loans }: Props) {
  if (loans.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-faint">最近借还记录</div>
      <div className="mt-2 space-y-1.5">
        {loans.map(l => {
          const borrower = displayName(l.user) || l.user?.username || "用户 #" + l.userId;
          const returner = l.returnedAt ? (displayName(l.returnedBy) || l.returnedBy?.username || "本人") : null;
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-faint">{l.battery?.code ?? "电池 #" + l.batteryId}</span>
              <span className="text-muted">借用人</span>
              <span className="font-medium">{borrower}</span>
              <span className="text-faint">{formatTime(l.borrowedAt)}</span>
              {l.returnedAt ? (
                <>
                  <span className="text-faint">→</span>
                  <span className="text-muted">归还人</span>
                  <span className="font-medium">{returner}</span>
                  <span className="text-faint">{formatTime(l.returnedAt)}</span>
                </>
              ) : (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">未归还</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

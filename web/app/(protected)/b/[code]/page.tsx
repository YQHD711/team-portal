"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowLeft, BatteryCharging, Loader2, QrCode } from "lucide-react";
import { statusMeta, formatTime, isOverdue, type BatteryItem } from "@/components/battery/batteryTypes";

/**
 * 电池扫码落地页：/b/<电池编码>。
 *
 * 电池标签上的二维码就指向这里。手机相机扫开即可看到电池状态，
 * 已登录用户点一下就能借出/归还；未登录由 (protected) 布局的 AuthGuard 跳登录并回跳。
 */
export default function BatteryByCodePage() {
  const params = useParams();
  const router = useRouter();
  const raw = params.code;
  const code = decodeURIComponent(Array.isArray(raw) ? raw[0] : (raw ?? ""));

  const [battery, setBattery] = useState<BatteryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!code) return;
    setLoading(true);
    api.get<BatteryItem>(`/api/battery/by-code/${encodeURIComponent(code)}`)
      .then(b => { setBattery(b); setNotFound(false); })
      .catch(() => { setBattery(null); setNotFound(true); })
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const act = async (kind: "borrow" | "return") => {
    if (!battery) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/battery/${battery.id}/${kind}`, {});
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  if (notFound || !battery) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <QrCode className="mx-auto h-12 w-12 text-faint opacity-40" />
        <div>
          <h1 className="text-lg font-bold">没有找到这个电池编码</h1>
          <p className="mt-1 text-sm text-muted"><span className="font-mono">{code}</span> 不在电池台账里。</p>
          <p className="mt-2 text-xs text-faint">可能是标签印错、电池已删除，或还没录入系统。</p>
        </div>
        <button onClick={() => router.push("/batteries")} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
          去电池台账
        </button>
      </div>
    );
  }

  const meta = statusMeta(battery.status);
  const overdue = isOverdue(battery);
  const canBorrow = battery.status === "in_stock";
  const canReturn = battery.status === "borrowed";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <button onClick={() => router.push("/batteries")} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回电池台账
      </button>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-sm text-faint">{battery.code}</div>
            <h1 className="mt-1 text-xl font-bold">{battery.model || "未填型号"}</h1>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>{meta.text}</span>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {battery.status === "borrowed" ? (
            <div>
              <span className="text-muted">当前借用人：</span>
              <span className="font-medium">{battery.currentBorrower?.username ?? `用户 #${battery.currentBorrowerId}`}</span>
              <span className="ml-2 text-faint">借出于 {formatTime(battery.borrowedAt)}</span>
            </div>
          ) : (
            <div className="text-muted">当前在库，可借出</div>
          )}
          {battery.health && <div className="text-muted">健康度：{battery.health}</div>}
          {overdue && <div className="font-medium text-danger">⚠ 已超过 24 小时未归还</div>}
          {battery.notes && <div className="text-faint">{battery.notes}</div>}
        </div>

        {error && <div className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <div className="mt-5 space-y-2">
          {canBorrow && (
            <button onClick={() => act("borrow")} disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}
              借出这块电池
            </button>
          )}
          {canReturn && (
            <button onClick={() => act("return")} disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}
              归还这块电池
            </button>
          )}
          {!canBorrow && !canReturn && (
            <div className="rounded-xl bg-surface-subtle p-3 text-center text-sm text-muted">
              该电池当前状态为「{meta.text}」，不能借出或归还
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-faint">
        借出/归还都会记录操作人和时间，可在「电池借还」页查看记录
      </p>
    </div>
  );
}

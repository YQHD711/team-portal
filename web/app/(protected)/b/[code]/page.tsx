"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowLeft, BatteryCharging, Loader2, QrCode } from "lucide-react";
import { displayName, statusMeta, formatTime, isOverdue, type BatteryItem } from "@/components/battery/batteryTypes";

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
/** URL 段解码：畸形 % 序列（标签磨损后手输）会抛 URIError，回落原始字符串。 */
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

  const code = safeDecode(Array.isArray(raw) ? raw[0] : (raw ?? ""));

  const [battery, setBattery] = useState<BatteryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  // 归还健康检查：归还前必须声明健康度（异常自动转维修，坏电池不静默回库）
  const [showReturnHealth, setShowReturnHealth] = useState(false);
  // 电池事故关联：事故记录（/api/batteries）按编号关联到本电池
  const [incidents, setIncidents] = useState<{ id: number; batteryNumber: string; health: string; incidentDate: string; notes: string | null }[]>([]);
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

  // 拉取该电池的事故记录（弱关联：按编号匹配台账编码）
  useEffect(() => {
    api.get<{ id: number; batteryNumber: string; health: string; incidentDate: string; notes: string | null }[]>("/api/batteries")
      .then(list => setIncidents(list.filter(b => b.batteryNumber?.toUpperCase() === code.toUpperCase())))
      .catch(() => {});
  }, [code]);

  const act = async (kind: "borrow" | "return", health?: string) => {
    if (!battery) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/battery/${battery.id}/${kind}`, health ? { health } : {});
      setShowReturnHealth(false);
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
              <span className="font-medium">{displayName(battery.currentBorrower) || `用户 #${battery.currentBorrowerId}`}</span>
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
          {canReturn && !showReturnHealth && (
            <button onClick={() => setShowReturnHealth(true)} disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}
              归还这块电池
            </button>
          )}
          {canReturn && showReturnHealth && (
            <div className="rounded-xl border border-border p-3 text-left">
              <div className="text-sm font-medium">归还前请确认电池状态</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {["正常", "鼓包", "漏液", "过放", "报废"].map(h => (
                  <button key={h} onClick={() => act("return", h)} disabled={busy}
                    className={`rounded-lg border px-2 py-2 text-sm disabled:opacity-50 ${h === "正常" ? "border-emerald-400 text-emerald-700" : "border-danger/50 text-danger"}`}>
                    {h}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">选「正常」回库；异常会自动转维修禁借并通知管理员</p>
              <button onClick={() => setShowReturnHealth(false)} className="mt-2 text-xs text-muted underline">取消</button>
            </div>
          )}
          {!canBorrow && !canReturn && (
            <div className="rounded-xl bg-surface-subtle p-3 text-center text-sm text-muted">
              该电池当前状态为「{meta.text}」，不能借出或归还
            </div>
          )}
        </div>
      </div>

      {/* 事故关联：按编号匹配台账编码（事故安全页登记的记录） */}
      {incidents.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <div className="text-sm font-medium text-warning">⚠ 该电池有 {incidents.length} 条事故记录</div>
          <div className="mt-2 space-y-1.5">
            {incidents.map(i => (
              <div key={i.id} className="text-xs">
                <span className="text-faint">{new Date(i.incidentDate).toLocaleDateString("zh-CN")}</span>
                <span className="mx-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning">{i.health}</span>
                {i.notes && <span className="text-muted">{i.notes}</span>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">事故详情在「事故安全 → 电池事故」维护；此处按电池编号关联</p>
        </div>
      )}

      <p className="text-center text-xs text-faint">
        借出/归还都会记录操作人和时间，可在「电池借还」页查看记录
      </p>
    </div>
  );
}

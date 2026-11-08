"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Loader2, Plus, QrCode, ScanLine, Search } from "lucide-react";
import { BatteryCard } from "@/components/battery/BatteryCard";
import { BatteryLabelExportButton } from "@/components/battery/BatteryLabelExportButton";
import { type BatteryItem, type BatteryLoan } from "@/components/battery/batteryTypes";

const STATUS_FILTERS = [
  { value: "", label: "全部" },
  { value: "in_stock", label: "在库" },
  { value: "borrowed", label: "借出" },
  { value: "charging", label: "充电中" },
  { value: "repair", label: "维修中" },
  { value: "retired", label: "已退役" },
];

export default function BatteriesPage() {
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";

  const [items, setItems] = useState<BatteryItem[]>([]);
  const [mine, setMine] = useState<BatteryLoan[]>([]);
  const [overdue, setOverdue] = useState<BatteryLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", model: "", health: "正常", notes: "" });

  const fetchAll = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (search.trim()) q.set("search", search.trim());
    Promise.all([
      api.get<BatteryItem[]>(`/api/battery?${q.toString()}`).then(setItems).catch(() => {}),
      api.get<BatteryLoan[]>("/api/battery/mine").then(setMine).catch(() => {}),
      api.get<BatteryLoan[]>("/api/battery/overdue").then(setOverdue).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [status, search]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const doBorrow = async (b: BatteryItem) => {
    setBusyId(b.id);
    try { await api.post(`/api/battery/${b.id}/borrow`, {}); fetchAll(); }
    finally { setBusyId(null); }
  };

  const doReturn = async (b: BatteryItem) => {
    setBusyId(b.id);
    try { await api.post(`/api/battery/${b.id}/return`, {}); fetchAll(); }
    finally { setBusyId(null); }
  };

  const createBattery = async () => {
    await api.post("/api/battery", {
      code: form.code.trim() || null,
      model: form.model.trim() || null,
      health: form.health,
      notes: form.notes.trim() || null,
    });
    setShowForm(false);
    setForm({ code: "", model: "", health: "正常", notes: "" });
    fetchAll();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">电池借还</h1>
          <p className="text-sm text-muted">扫码或点按钮即可借出/归还，记录自动关联到当前账号</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/batteries/scan" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
            <ScanLine className="h-4 w-4" />扫码借还
          </Link>
          {isStaff && <BatteryLabelExportButton batteries={items} />}
          {isStaff && (
            <button onClick={() => setShowForm(v => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-white">
              <Plus className="h-4 w-4" />新增电池
            </button>
          )}
        </div>
      </div>

      {(mine.length > 0 || overdue.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs font-medium text-faint">我在借</div>
            <div className="mt-1 text-2xl font-bold">{mine.length}</div>
          </div>
          <div className={`rounded-xl border p-4 ${overdue.length > 0 ? "border-danger/50 bg-danger/5" : "border-border bg-surface"}`}>
            <div className="text-xs font-medium text-faint">超时未还（全队）</div>
            <div className={`mt-1 text-2xl font-bold ${overdue.length > 0 ? "text-danger" : ""}`}>{overdue.length}</div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              编码（留空自动生成）
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="BAT-0001" />
            </label>
            <label className="block text-xs font-medium">
              型号
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="6S 3300mAh" />
            </label>
            <label className="block text-xs font-medium">
              健康度
              <select value={form.health} onChange={e => setForm({ ...form, health: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
                {["正常", "鼓包", "漏液", "过放", "报废"].map(h => <option key={h}>{h}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">
              备注
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm">取消</button>
            <button onClick={createBattery} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">保存</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") fetchAll(); }}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm" placeholder="搜编码或型号，回车查询" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          {STATUS_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={fetchAll} className="rounded-lg border border-border px-3 py-2 text-sm">刷新</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-faint">
          <QrCode className="mx-auto mb-3 h-10 w-10 opacity-40" />
          还没有电池。{isStaff ? "点右上角「新增电池」建第一块。" : "等管理员录入电池台账。"}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(b => (
            <BatteryCard key={b.id} battery={b} busy={busyId === b.id}
              onBorrow={doBorrow} onReturn={doReturn} />
          ))}
        </div>
      )}
    </div>
  );
}

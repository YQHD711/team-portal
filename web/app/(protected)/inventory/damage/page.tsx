"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { AlertTriangle, Plus, ShieldAlert, Package } from "lucide-react";
import Link from "next/link";

interface Item { id: number; name: string; grade: string; }
interface DamageReport {
  id: number; inventoryItemId: number; type: string;
  description: string; isApprovedTest: boolean;
  liability: string; compensationAmount?: number; resolution?: string;
  createdAt: string;
  item?: Item;
  user?: { id: number; username: string };
}

const liabilityLabels: Record<string, string> = {
  pending: "待定责", exempt: "免责", compensate: "需赔偿",
};

export default function DamagePage() {
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ itemId: 0, type: "damage", description: "", isApprovedTest: false });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [r, me, inv] = await Promise.all([
        api.get<DamageReport[]>("/api/material/damage-report"),
        api.get<{ role: string }>("/api/auth/me").catch(() => ({ role: "" })),
        api.get<Item[]>("/api/inventory"),
      ]);
      setReports(r); setRole(me.role); setItems(inv);
    } catch { }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const submit = async () => {
    if (!form.itemId || !form.description) { alert("请填写完整"); return; }
    try {
      await api.post("/api/material/damage-report", form);
      setShowForm(false); setForm({ itemId: 0, type: "damage", description: "", isApprovedTest: false });
      fetchData();
    } catch (e: any) { alert(e.message || "提交失败"); }
  };

  const resolve = async (id: number, liability: string) => {
    const amount = liability === "compensate" ? prompt("赔偿金额 ¥：") : null;
    const resolution = prompt("处理备注（可选）：");
    try {
      await api.put(`/api/material/damage-report/${id}/resolve`, {
        liability,
        compensationAmount: amount ? parseFloat(amount) : null,
        resolution: resolution || null,
      });
      fetchData();
    } catch (e: any) { alert(e.message || "定责失败"); }
  };

  const isAdmin = role === "admin";

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">损坏/遗失报备</h1>
          <p className="text-sm text-zinc-500">记录物料异常情况，按管理办法追责</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory" className="text-sm text-sky-500 hover:text-sky-600 flex items-center gap-1">
            <Package className="h-4 w-4" /> 返回库存
          </Link>
        </div>
      </div>

      <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 shadow-sm w-fit">
        <Plus className="h-4 w-4" /> 报备损坏/遗失
      </button>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? <div className="p-8 text-center text-zinc-400">加载中...</div> :
         reports.length === 0 ? <div className="p-8 text-center text-zinc-400"><ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无报备记录</div> :
         <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {reports.map(r => (
            <div key={r.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.item?.name || `#${r.inventoryItemId}`}</span>
                    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.item?.grade === "A" ? "bg-red-100 text-red-700" : r.item?.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>{r.item?.grade || "?"}级</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${r.type === "damage" ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"}`}>{r.type === "damage" ? "损坏" : "遗失"}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${r.liability === "exempt" ? "bg-green-100 text-green-700" : r.liability === "compensate" ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-500"}`}>{liabilityLabels[r.liability]}</span>
                  </div>
                  <div className="text-sm mt-1">{r.description}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {r.user?.username} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                    {r.isApprovedTest && " · 经批准测试"}
                    {r.compensationAmount != null && ` · 赔偿 ¥${r.compensationAmount}`}
                    {r.resolution && ` · ${r.resolution}`}
                  </div>
                </div>
                {r.liability === "pending" && isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button onClick={() => resolve(r.id, "exempt")} className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600">免责</button>
                    <button onClick={() => resolve(r.id, "compensate")} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600">需赔偿</button>
                  </div>
                )}
              </div>
            </div>
          ))}
         </div>
        }
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">报备损坏/遗失</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">零件</label>
                <select value={form.itemId} onChange={e => setForm({ ...form, itemId: Number(e.target.value) })}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm">
                  <option value={0}>选择零件...</option>
                  {items.filter(i => i.grade === "A" || i.grade === "B").map(i => <option key={i.id} value={i.id}>{i.name} ({i.grade}级)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">类型</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm">
                  <option value="damage">损坏</option>
                  <option value="loss">遗失</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="详细描述损坏/遗失情况..." className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm h-24" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isApprovedTest} onChange={e => setForm({ ...form, isApprovedTest: e.target.checked })}
                  className="rounded border-zinc-300" />
                属于经批准的测试/飞行中损坏（免责情形）
              </label>
              <button onClick={submit} className="w-full rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600">
                <AlertTriangle className="h-4 w-4 inline mr-1" />提交报备
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

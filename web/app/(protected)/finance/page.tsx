"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Plus, Check, X, ShoppingCart, PackageCheck, Loader2, TrendingUp, FileText } from "lucide-react";

interface PurchaseReq { id: number; itemName: string; quantity: number; estimatedPrice: number; actualPrice: number | null; reason: string; status: string; requester: { username: string } | null; approver: { username: string } | null; approvedAt: string | null; purchasedAt: string | null; receivedAt: string | null; rejectReason: string | null; createdAt: string; }
interface Stats { pending: number; approved: number; purchased: number; received: number; totalSpent: number; thisMonth: number; }
interface MonthlyReport { year: number; month: number; totalRequests: number; approvedCount: number; receivedCount: number; rejectedCount: number; estimatedTotal: number; actualTotal: number; requests: any[]; }

const STATUS_LABELS: Record<string, string> = { pending: "待审批", approved: "已批准", purchased: "已购买", received: "已入库", rejected: "已拒绝" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700", approved: "bg-blue-100 text-blue-700",
  purchased: "bg-purple-100 text-purple-700", received: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700"
};

export default function FinancePage() {
  const [tab, setTab] = useState<string>("my");
  const [requests, setRequests] = useState<PurchaseReq[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const isAdmin = user?.role === "admin";

  // Form
  const [showForm, setShowForm] = useState(false);
  const [itemName, setItemName] = useState(""); const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(""); const [reason, setReason] = useState("");

  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);

  useEffect(() => { fetchData(); }, []);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      api.get<PurchaseReq[]>("/api/finance/requests").then(setRequests).catch(()=>{}),
      api.get<Stats>("/api/finance/stats").then(setStats).catch(()=>{}),
    ]).finally(() => setLoading(false));
  };

  const fetchAll = () => api.get<PurchaseReq[]>("/api/finance/requests/all").then(setRequests);
  const fetchReport = () => api.get<MonthlyReport>(`/api/finance/report/monthly?year=${reportYear}&month=${reportMonth}`).then(setReport);

  const submitRequest = async () => {
    await api.post("/api/finance/requests", { itemName, quantity: parseInt(qty)||1, estimatedPrice: parseFloat(price)||0, reason });
    setShowForm(false); setItemName(""); setQty("1"); setPrice(""); setReason("");
    fetchData();
  };

  const approve = (id: number) => api.post(`/api/finance/requests/${id}/approve`, {}).then(fetchData);
  const reject = async (id: number) => {
    const reason = prompt("拒绝原因：");
    if (!reason) return;
    await api.post(`/api/finance/requests/${id}/reject`, { reason });
    fetchData();
  };
  const [purchaseId, setPurchaseId] = useState<number | null>(null);
  const [purchasePrice, setPurchasePrice] = useState("");

  const markPurchased = async () => {
    if (!purchaseId || !purchasePrice) return;
    await api.post(`/api/finance/requests/${purchaseId}/purchase`, { actualPrice: parseFloat(purchasePrice) });
    setPurchaseId(null); setPurchasePrice(""); fetchData();
  };
  const markReceived = (id: number) => api.post(`/api/finance/requests/${id}/receive`, {}).then(fetchData);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">采购申请</h1><p className="text-sm text-muted">申请 · 审批 · 购买 · 入库 · 报表</p></div>
        {isStaff && <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"><Plus className="h-4 w-4"/>申请采购</button>}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border p-3 bg-surface text-center"><div className="text-xl font-bold text-warning">{stats.pending}</div><div className="text-xs text-faint">待审批</div></div>
          <div className="rounded-xl border p-3 bg-surface text-center"><div className="text-xl font-bold text-primary">{stats.approved}</div><div className="text-xs text-faint">已批准</div></div>
          <div className="rounded-xl border p-3 bg-surface text-center"><div className="text-xl font-bold text-purple-600">{stats.purchased}</div><div className="text-xs text-faint">已购买</div></div>
          <div className="rounded-xl border p-3 bg-surface text-center"><div className="text-xl font-bold text-success">{stats.received}</div><div className="text-xs text-faint">已入库</div></div>
          <div className="rounded-xl border p-3 bg-surface text-center"><div className="text-xl font-bold text-zinc-700">¥{stats.totalSpent.toFixed(0)}</div><div className="text-xs text-faint">总支出</div></div>
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative bg-surface rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">采购申请</h2>
            <div><label className="block text-sm font-medium mb-1">物品名称</label><input value={itemName} onChange={e=>setItemName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如：螺旋桨 1045"/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">数量</label><input type="number" value={qty} onChange={e=>setQty(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div><label className="block text-sm font-medium mb-1">预估单价(¥)</label><input type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">申请理由</label><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="说明采购原因..."/></div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border">取消</button>
              <button onClick={submitRequest} className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover">提交申请</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {[
          { key: "my", label: "我的申请" },
          ...(isStaff ? [{ key: "all" as const, label: "全部申请" }] : []),
          ...(isAdmin ? [{ key: "report" as const, label: "月度报表" }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key==="all") fetchAll(); if (t.key==="report") fetchReport(); else fetchData(); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Requests list */}
      {tab !== "report" && (
        <div className="space-y-3">
          {requests.length === 0 ? <div className="rounded-xl border bg-surface p-12 text-center text-faint">暂无采购申请</div> : requests.map(r => {
            const steps = ["pending", "approved", "purchased", "received"];
            const currentStep = r.status === "rejected" ? -1 : steps.indexOf(r.status);
            return (
            <div key={r.id} className="rounded-xl border bg-surface p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{r.itemName}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  </div>
                  <div className="text-sm text-muted mt-1 space-x-3">
                    <span>x{r.quantity}</span>
                    <span>预估 ¥{r.estimatedPrice}</span>
                    {r.actualPrice && <span className="text-zinc-700 font-medium">实际 ¥{r.actualPrice}</span>}
                    <span>{r.requester?.username}</span>
                    <span>{new Date(r.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                  {r.reason && <div className="text-sm text-faint mt-1">📝 {r.reason}</div>}
                  {r.rejectReason && <div className="text-sm text-danger mt-1">❌ {r.rejectReason}</div>}
                </div>
              </div>

              {/* Status flow bar (skip for rejected) */}
              {r.status !== "rejected" && (
                <div className="flex items-center gap-0">
                  {["待审批", "已批准", "已购买", "已入库"].map((label, i) => {
                    const done = i <= currentStep;
                    const active = i === currentStep;
                    return (
                      <div key={i} className="flex-1 flex items-center">
                        <div className={`flex flex-col items-center flex-1 ${i > 0 ? "" : ""}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${done ? (active ? "bg-primary text-white ring-4 ring-sky-100 dark:ring-sky-900" : "bg-success text-white") : "bg-zinc-200 dark:bg-zinc-700 text-faint"}`}>
                            {done && !active ? "✓" : i + 1}
                          </div>
                          <span className={`text-[11px] mt-1 font-medium ${done ? "text-zinc-700 dark:text-zinc-300" : "text-faint"}`}>{label}</span>
                        </div>
                        {i < 3 && (
                          <div className={`h-0.5 flex-1 -mt-5 mx-1 rounded transition-all ${i < currentStep ? "bg-green-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-1 border-t border-border">
                {r.status === "pending" && isAdmin && (
                  <div className="flex gap-2 w-full">
                    <button onClick={()=>approve(r.id)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white hover:bg-success transition-colors"><Check className="h-4 w-4"/>批准采购</button>
                    <button onClick={()=>reject(r.id)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-medium text-danger hover:bg-red-100 transition-colors"><X className="h-4 w-4"/>拒绝</button>
                  </div>
                )}
                {r.status === "approved" && isStaff && (
                  <div className="w-full space-y-2">
                    {purchaseId === r.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-sm text-muted shrink-0">实际金额 ¥</span>
                        <input type="number" step="0.01" value={purchasePrice} onChange={e=>setPurchasePrice(e.target.value)} placeholder="0.00" className="flex-1 rounded-lg border px-3 py-2 text-sm" autoFocus />
                        <button onClick={markPurchased} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-accent-hover shrink-0">确认</button>
                        <button onClick={()=>{setPurchaseId(null);setPurchasePrice("");}} className="px-3 py-2 rounded-lg border text-sm shrink-0">取消</button>
                      </div>
                    ) : (
                      <button onClick={()=>setPurchaseId(r.id)} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"><ShoppingCart className="h-4 w-4"/>标记已购买</button>
                    )}
                  </div>
                )}
                {r.status === "purchased" && isStaff && (
                  <button onClick={()=>markReceived(r.id)} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white hover:bg-success transition-colors"><PackageCheck className="h-4 w-4"/>确认收货并入库存</button>
                )}
                {r.status === "received" && (
                  <div className="w-full text-center text-sm text-success font-medium py-2">✅ 已完成入库，物品已加入库存</div>
                )}
                {r.status === "rejected" && (
                  <div className="w-full text-center text-sm text-danger font-medium py-2">此申请已被拒绝</div>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Monthly Report */}
      {tab === "report" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select value={reportYear} onChange={e=>setReportYear(parseInt(e.target.value))} className="rounded-lg border px-3 py-2 text-sm">
              {[2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-sm">年</span>
            <select value={reportMonth} onChange={e=>setReportMonth(parseInt(e.target.value))} className="rounded-lg border px-3 py-2 text-sm">
              {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-sm">月</span>
            <button onClick={fetchReport} className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover">查询</button>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl border p-4 bg-surface"><div className="text-2xl font-bold">{report.totalRequests}</div><div className="text-xs text-faint">总申请</div></div>
                <div className="rounded-xl border p-4 bg-surface"><div className="text-2xl font-bold text-success">{report.approvedCount}</div><div className="text-xs text-faint">已批准</div></div>
                <div className="rounded-xl border p-4 bg-surface"><div className="text-2xl font-bold text-danger">{report.rejectedCount}</div><div className="text-xs text-faint">已拒绝</div></div>
                <div className="rounded-xl border p-4 bg-surface"><div className="text-2xl font-bold text-zinc-700">¥{(report.actualTotal || 0).toFixed(0)}</div><div className="text-xs text-faint">实际支出</div></div>
              </div>

              <div className="rounded-xl border bg-surface divide-y overflow-x-auto">
                <div className="grid grid-cols-7 gap-2 p-3 text-xs font-medium text-muted bg-surface-subtle min-w-[600px]"><div>物品</div><div>数量</div><div>预估</div><div>实际</div><div>申请人</div><div>状态</div><div>日期</div></div>
                {report.requests.length === 0 ? <div className="p-8 text-center text-faint">本月暂无采购记录</div> :
                  report.requests.map((r: any) => (
                    <div key={r.id} className="grid grid-cols-7 gap-2 p-3 text-sm items-center min-w-[600px]">
                      <div className="font-medium truncate">{r.itemName}</div><div>{r.quantity}</div><div>¥{r.estimatedPrice}</div><div>{r.actualPrice ? `¥${r.actualPrice}` : "-"}</div><div className="text-xs">{r.requester}</div>
                      <div><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span></div>
                      <div className="text-xs">{new Date(r.createdAt).toLocaleDateString("zh-CN")}</div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

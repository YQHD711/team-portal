"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Package, Check, X, ArrowLeftRight, Clock, ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";

interface Item { id: number; name: string; grade: string; quantity: number; category: string; locationCode?: string; }
interface CheckoutReq {
  id: number; inventoryItemId: number; quantity: number; grade: string;
  status: string; note?: string; rejectReason?: string;
  createdAt: string; approvedAt?: string; returnedAt?: string;
  item?: Item;
  requester?: { id: number; username: string; department?: { name: string } };
  deptApprover?: { username: string }; adminApprover?: { username: string };
  checkin?: { condition: string; hasPhoto: boolean; testNotes?: string; createdAt: string };
}

const statusLabels: Record<string, string> = {
  pending_dept: "待部长审批", pending_admin: "待管理员审批",
  approved: "已批准", rejected: "已驳回", returned: "已归还",
};

export default function CheckoutPage() {
  const [tab, setTab] = useState<"my" | "pending">("my");
  const [my, setMy] = useState<CheckoutReq[]>([]);
  const [pending, setPending] = useState<CheckoutReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [newForm, setNewForm] = useState({ itemId: 0, quantity: 1, note: "" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [myList, me, items] = await Promise.all([
        api.get<CheckoutReq[]>("/api/material/checkout/my"),
        api.get<{ role: string }>("/api/auth/me").catch(() => ({ role: "" })),
        api.get<Item[]>("/api/inventory"),
      ]);
      setMy(myList);
      setAllItems(items.filter(i => i.quantity > 0));
      setRole(me.role);
      if (me.role === "admin" || me.role === "部长") {
        const p = await api.get<CheckoutReq[]>("/api/material/checkout/pending");
        setPending(p);
      }
    } catch { }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const submitNew = async () => {
    if (!newForm.itemId) { alert("请选择物料"); return; }
    try {
      const res = await fetch("/api/material/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ itemId: newForm.itemId, quantity: newForm.quantity, note: newForm.note || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || "提交失败"); return; }
      if (data.status === "approved") alert("C级物料，领用成功！");
      else alert(`${data.grade}级物料，已提交审批。`);
      setShowNew(false); setNewForm({ itemId: 0, quantity: 1, note: "" });
      fetchData();
    } catch { alert("提交失败"); }
  };

  const filtered = allItems.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.category.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const approveDept = async (id: number) => {
    try { await api.post(`/api/material/checkout/${id}/approve-dept`, {}); fetchData(); }
    catch { alert("审批失败"); }
  };
  const approveAdmin = async (id: number) => {
    try { await api.post(`/api/material/checkout/${id}/approve-admin`, {}); fetchData(); }
    catch { alert("审批失败"); }
  };
  const reject = async (id: number) => {
    const reason = prompt("驳回原因（可选）：");
    try { await api.post(`/api/material/checkout/${id}/reject`, { reason: reason || "未说明原因" }); fetchData(); }
    catch { alert("驳回失败"); }
  };
  const checkin = async (id: number) => {
    const grade = my.find(r => r.id === id)?.grade;
    if (grade === "A") {
      alert("A级物料归还需由管理员/部长操作（需上传照片+功能测试说明）");
      return;
    }
    try { await api.post(`/api/material/checkout/${id}/checkin`, { condition: "normal", hasPhoto: false }); fetchData(); }
    catch (e: any) { alert(e.message || "归还失败"); }
  };

  const isStaff = role === "admin" || role === "部长";
  const isAdmin = role === "admin";

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">领用管理</h1>
          <p className="text-sm text-zinc-500">物料领用申请与审批</p>
        </div>
        <Link href="/inventory" className="text-sm text-sky-500 hover:text-sky-600 flex items-center gap-1">
          <Package className="h-4 w-4" /> 返回库存
        </Link>
      </div>

      {/* 新建领用 */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        {!showNew ? (
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600 shadow-sm">
            <Plus className="h-4 w-4" />新建领用申请
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">新建领用申请</h3>
              <button onClick={() => setShowNew(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input type="text" placeholder="搜索物料..." value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-9 pr-3 py-2 text-sm" />
            </div>
            <div className="max-h-48 overflow-y-auto border rounded-lg divide-y dark:border-zinc-700">
              {filtered.slice(0, 20).map(item => (
                <button key={item.id}
                  onClick={() => setNewForm({ ...newForm, itemId: item.id })}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${newForm.itemId === item.id ? "bg-sky-50 dark:bg-sky-950 ring-1 ring-sky-300" : ""}`}>
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-zinc-400 ml-2">{item.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${item.grade === "A" ? "bg-red-100 text-red-700" : item.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>{item.grade}</span>
                    <span className="text-xs text-zinc-400">库存: {item.quantity}</span>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">无匹配物料</div>}
            </div>
            <div className="flex gap-2">
              <input type="number" min={1} max={allItems.find(i => i.id === newForm.itemId)?.quantity || 1}
                value={newForm.quantity} onChange={e => setNewForm({ ...newForm, quantity: Number(e.target.value) })}
                className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
              <input type="text" placeholder="用途备注（选填）" value={newForm.note}
                onChange={e => setNewForm({ ...newForm, note: e.target.value })}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
              <button onClick={submitNew} disabled={!newForm.itemId}
                className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed">
                提交申请
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
        <button onClick={() => setTab("my")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "my" ? "bg-white dark:bg-zinc-900 shadow-sm" : "text-zinc-500"}`}>
          我的领用 ({my.length})
        </button>
        {isStaff && (
          <button onClick={() => setTab("pending")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "pending" ? "bg-white dark:bg-zinc-900 shadow-sm" : "text-zinc-500"}`}>
            待审批 ({pending.length})
          </button>
        )}
      </div>

      {tab === "my" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {loading ? <div className="p-8 text-center text-zinc-400">加载中...</div> :
           my.length === 0 ? <div className="p-8 text-center text-zinc-400"><ArrowLeftRight className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无领用记录</div> :
           <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {my.map(r => (
              <div key={r.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.item?.name || `#${r.inventoryItemId}`}</span>
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.grade === "A" ? "bg-red-100 text-red-700" : r.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>{r.grade}级</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${r.status === "approved" ? "bg-green-100 text-green-700" : r.status === "rejected" ? "bg-red-100 text-red-700" : r.status === "returned" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{statusLabels[r.status] || r.status}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {r.quantity} 件 · {r.note || "无备注"} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </div>
                    {r.rejectReason && <div className="text-xs text-red-500 mt-1">驳回原因: {r.rejectReason}</div>}
                    {r.status === "returned" && r.checkin && (
                      <div className="text-xs text-blue-500 mt-1">归还: {r.checkin.condition === "damaged" ? "⚠️ 有损坏" : "✅ 完好"} · {new Date(r.checkin.createdAt).toLocaleString("zh-CN")}</div>
                    )}
                  </div>
                  {r.status === "approved" && (
                    <button onClick={() => checkin(r.id)} className="ml-2 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 shrink-0">
                      归还
                    </button>
                  )}
                </div>
              </div>
            ))}
           </div>
          }
        </div>
      )}

      {tab === "pending" && isStaff && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {pending.length === 0 ? <div className="p-8 text-center text-zinc-400"><Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无待审批申请</div> :
           <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pending.map(r => (
              <div key={r.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.item?.name}</span>
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.grade === "A" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{r.grade}级</span>
                      <span className="text-xs text-zinc-500">→ {statusLabels[r.status]}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {r.requester?.username} 申请 {r.quantity} 件 · {r.note || "无备注"} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(r.status === "pending_dept" || (r.status === "pending_admin" && isAdmin)) && (
                      <>
                        {r.status === "pending_dept" && (
                          <button onClick={() => approveDept(r.id)} className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600"><Check className="h-3 w-3 inline mr-1" />批准</button>
                        )}
                        {r.status === "pending_admin" && isAdmin && (
                          <button onClick={() => approveAdmin(r.id)} className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600"><Check className="h-3 w-3 inline mr-1" />终审通过</button>
                        )}
                        <button onClick={() => reject(r.id)} className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"><X className="h-3 w-3 inline mr-1" />驳回</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
           </div>
          }
        </div>
      )}
    </div>
  );
}

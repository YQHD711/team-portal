"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Search, AlertTriangle, Package, Filter, Plus, Pencil, Trash2, X, Upload, Minus, Plus as PlusIcon, History, Loader2 } from "lucide-react";

interface InventoryItem { id: number; name: string; category: string; quantity: number; location: string; status: string; updatedAt: string; photoUrl?: string; }
interface Transaction { id: number; type: string; quantity: number; userName: string; note: string | null; createdAt: string; }
const COLORS = ["#0284c7", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];
const LOW_THRESHOLD = 3;
const statusOpts = [
  { value: "available", label: "可用" },
  { value: "in_use", label: "使用中" },
  { value: "broken", label: "损坏" },
];

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState({ name: "", category: "", quantity: 0, location: "", status: "available" });
  const [importMsg, setImportMsg] = useState("");
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [txMode, setTxMode] = useState<"checkout" | "checkin" | null>(null);
  const [txQty, setTxQty] = useState(1);
  const [txNote, setTxNote] = useState("");
  const [txHistory, setTxHistory] = useState<Transaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const handleTransaction = async () => {
    if (!txItem || !txMode) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/inventory/${txItem.id}/${txMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quantity: txQty, note: txNote || null }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.detail || err.title || "操作失败"); return; }
      setTxItem(null); setTxMode(null); setTxQty(1); setTxNote("");
      fetchItems();
    } catch { alert("操作失败"); }
  };

  const fetchHistory = async (item: InventoryItem) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/inventory/${item.id}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      setTxHistory(await res.json());
      setTxItem(item);
      setShowHistory(true);
    } catch { setTxHistory([]); }
  };

  useEffect(() => { const t = setTimeout(() => fetchItems(), 300); return () => clearTimeout(t); }, [search, category]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      setItems(await api.get<InventoryItem[]>(`/api/inventory?${params}`));
    } catch { setItems([]); }
    finally { setLoading(false); }
  };

  const openCreate = () => { setEditItem(null); setForm({ name: "", category: "", quantity: 0, location: "", status: "available" }); setShowForm(true); };
  const openEdit = (i: InventoryItem) => { setEditItem(i); setForm({ name: i.name, category: i.category, quantity: i.quantity, location: i.location, status: i.status }); setShowForm(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editItem) await api.put(`/api/inventory/${editItem.id}`, { quantity: form.quantity, location: form.location, status: form.status });
      else await api.post("/api/inventory", form);
      setShowForm(false); fetchItems();
    } catch { alert("操作失败"); }
  };

  const handleDelete = async (i: InventoryItem) => {
    if (!confirm(`确认删除 "${i.name}"？`)) return;
    try { await api.delete(`/api/inventory/${i.id}`); fetchItems(); } catch { alert("删除失败"); }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg("导入中...");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/admin/documents/upload?folder=imports", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) throw new Error("导入失败");
      // Try importing via the API
      await api.post("/api/inventory/import", { filePath: `/data/knowledge/imports/${file.name}` });
      setImportMsg("导入成功"); fetchItems();
    } catch { setImportMsg("导入失败：Excel 文件格式可能不正确"); }
    finally { e.target.value = ""; }
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const chartData = categories.map(cat => ({ name: cat || "未分类", value: items.filter(i => i.category === cat).reduce((s, i) => s + i.quantity, 0) }));
  const lowItems = items.filter(i => i.quantity < LOW_THRESHOLD);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h1 className="text-2xl font-bold">零件库存</h1><p className="text-sm text-zinc-500">{items.length} 种 · 共 {totalItems} 件</p></div>
        <div className="flex gap-2">
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600 shadow-sm"><Plus className="h-4 w-4" />添加零件</button>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><Upload className="h-4 w-4" />导入 Excel<input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} className="hidden" /></label>
        </div>
      </div>

      {importMsg && <div className="text-sm p-2 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700">{importMsg}</div>}

      {lowItems.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-200"><strong>{lowItems.length}</strong> 种零件库存不足（低于 {LOW_THRESHOLD} 件）</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input type="text" placeholder="搜索零件..." value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">全部分类</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-surface">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-border">
            {loading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-3"><div className="h-16 shimmer rounded-lg" /></div>) :
             items.length === 0 ? <div className="p-8 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2" />暂无零件</div> :
             items.map(item => (
              <div key={item.id} className={`p-3 ${item.quantity < LOW_THRESHOLD ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-xs text-muted">{item.category} · {item.location || "—"}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setTxItem(item); setTxMode("checkout"); setTxQty(1); setTxNote(""); }} className="p-1 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500" title="借出"><Minus className="h-4 w-4" /></button>
                    <button onClick={() => { setTxItem(item); setTxMode("checkin"); setTxQty(1); setTxNote(""); }} className="p-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500" title="归还"><PlusIcon className="h-4 w-4" /></button>
                    <button onClick={() => fetchHistory(item)} className="p-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-4 w-4" /></button>
                    <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4 text-muted" /></button>
                    <button onClick={() => handleDelete(item)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950"><Trash2 className="h-4 w-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>{statusOpts.find(s => s.value === item.status)?.label || item.status}</span>
                  <span className={`text-lg font-bold ${item.quantity === 0 ? "text-red-500" : item.quantity < LOW_THRESHOLD ? "text-amber-500" : ""}`}>{item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-slate-50 dark:bg-slate-900"><th className="px-4 py-3 text-left font-medium text-muted">名称</th><th className="px-4 py-3 text-left font-medium text-muted hidden sm:table-cell">分类</th><th className="px-4 py-3 text-right font-medium text-muted">数量</th><th className="px-4 py-3 text-left font-medium text-muted hidden md:table-cell">位置</th><th className="px-4 py-3 text-left font-medium text-muted">状态</th><th className="px-4 py-3 text-right font-medium text-muted">操作</th></tr></thead>
              <tbody className="divide-y divide-border">
                {loading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 shimmer rounded" /></td>)}</tr>) :
                 items.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted"><Package className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无零件，点击"添加零件"开始</td></tr> :
                 items.map(item => (
                  <tr key={item.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-950 ${item.quantity < LOW_THRESHOLD ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                    <td className="px-4 py-3"><span className="font-medium">{item.name}</span><span className="block text-xs text-zinc-400 sm:hidden">{item.category}</span></td>
                    <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell">{item.category}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${item.quantity === 0 ? "text-red-600" : item.quantity < LOW_THRESHOLD ? "text-amber-600" : ""}`}>{item.quantity}</td>
                    <td className="px-4 py-3 text-zinc-500 hidden md:table-cell">{item.location || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "available" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : item.status === "in_use" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                        {statusOpts.find(s => s.value === item.status)?.label || item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setTxItem(item); setTxMode("checkout"); setTxQty(1); setTxNote(""); }} className="p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-500" title="借出"><Minus className="h-3.5 w-3.5" /></button>
                        <button onClick={() => { setTxItem(item); setTxMode("checkin"); setTxQty(1); setTxNote(""); }} className="p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-500" title="归还"><PlusIcon className="h-3.5 w-3.5" /></button>
                        <button onClick={() => fetchHistory(item)} className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-400" title="记录"><History className="h-3.5 w-3.5" /></button>
                        <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(item)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <h3 className="font-medium text-sm mb-3">分类分布</h3>
          {chartData.length > 0 ? (
            <><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" label={({ name, value }) => `${name ?? ""} ${value ?? 0}`} labelLine={false}>{chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={2} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            <div className="flex flex-wrap gap-3 justify-center mt-2">{chartData.map((d, i) => <div key={d.name} className="flex items-center gap-1.5 text-xs text-zinc-500"><span className="w-3 h-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{d.name}</div>)}</div></>
          ) : <div className="flex items-center justify-center h-[250px] text-zinc-400 text-sm">暂无数据</div>}
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editItem ? "编辑零件" : "添加零件"}</h2><button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">名称</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editItem} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="block text-sm font-medium mb-1">分类</label><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">数量</label><input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="block text-sm font-medium mb-1">位置</label><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">状态</label><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">{statusOpts.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
              <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600">{editItem ? "保存修改" : "添加零件"}</button>
            </form>
          </div>
        </div>
      )}

      {/* Checkout/Checkin Modal */}
      {txItem && txMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setTxItem(null); setTxMode(null); }}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{txMode === "checkout" ? "借出零件" : "归还零件"}</h3>
              <button onClick={() => { setTxItem(null); setTxMode(null); }}><X className="h-5 w-5 text-zinc-400" /></button>
            </div>
            <p className="text-sm text-zinc-500 mb-4">{txItem.name}（当前库存：{txItem.quantity}）</p>
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">数量</label><input type="number" min={1} max={txMode === "checkout" ? txItem.quantity : 999} value={txQty} onChange={e => setTxQty(Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">备注</label><input value={txNote} onChange={e => setTxNote(e.target.value)} placeholder="借用人/用途..." className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" /></div>
              <button onClick={handleTransaction} className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white ${txMode === "checkout" ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-500 hover:bg-emerald-600"}`}>
                {txMode === "checkout" ? `确认借出 ${txQty} 个` : `确认归还 ${txQty} 个`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History Panel */}
      {showHistory && txItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40" onClick={() => setShowHistory(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md max-h-[70vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">出入库记录 — {txItem.name}</h3>
              <button onClick={() => setShowHistory(false)}><X className="h-5 w-5 text-zinc-400" /></button>
            </div>
            {txHistory.length === 0 ? <p className="text-sm text-zinc-500 text-center py-4">暂无记录</p> :
              <div className="space-y-2">
                {txHistory.map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-sm">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${t.type === "checkout" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{t.type === "checkout" ? "借出" : "归还"}</span>
                    <span className="font-medium">{t.quantity}</span>
                    <span className="text-zinc-500 flex-1">{t.userName}{t.note ? ` · ${t.note}` : ""}</span>
                    <span className="text-xs text-zinc-400">{new Date(t.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      )}
    </div>
  );
}

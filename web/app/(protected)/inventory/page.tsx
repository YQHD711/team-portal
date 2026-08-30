"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, Plus, Upload } from "lucide-react";
import InventoryFilters from "@/components/inventory/InventoryFilters";
import InventoryTable from "@/components/inventory/InventoryTable";
import InventoryFormModal from "@/components/inventory/InventoryFormModal";
import InventoryTxModal from "@/components/inventory/InventoryTxModal";
import InventoryHistoryPanel from "@/components/inventory/InventoryHistoryPanel";
import { LOW_THRESHOLD, type Department, type InventoryFormState, type InventoryItem, type Transaction } from "@/components/inventory/inventoryTypes";

const COLORS = ["#0284c7", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];
const FALLBACK_ROOMS = ["1012", "1013", "1014", "1015", "201", "202", "203"];

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<InventoryFormState>({ name: "", category: "", quantity: 0, grade: "C", unitPrice: 0, departmentId: 0, projectTag: "", locationCode: "" });
  const [locRoom, setLocRoom] = useState("");
  const [locCabinet, setLocCabinet] = useState("");
  const [locShelf, setLocShelf] = useState("");
  const [locPos, setLocPos] = useState("");

  const buildLocCode = (room: string, cab: string, shelf: string, pos: string) => {
    const parts = [room, cab.padStart(2, "0"), shelf, pos.padStart(2, "0")].filter(Boolean);
    return parts.join("-");
  };
  const parseLocCode = (code: string) => {
    const parts = (code || "").split("-");
    setLocRoom(parts[0] || "");
    setLocCabinet(parts[1] || "");
    setLocShelf(parts[2] || "");
    setLocPos(parts[3] || "");
  };
  const [importMsg, setImportMsg] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const { user } = useCurrentUser();
  const role = user?.role ?? "";
  const [roomOpts, setRoomOpts] = useState<string[]>(FALLBACK_ROOMS);

  const calcGrade = (price: number) => price >= 1000 ? "A" : price >= 100 ? "B" : "C";
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [txMode, setTxMode] = useState<"checkout" | "checkin" | "consume" | null>(null);
  const [txQty, setTxQty] = useState(1);
  const [txNote, setTxNote] = useState("");
  const [txHistory, setTxHistory] = useState<Transaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const handleTransaction = async () => {
    if (!txItem || !txMode) return;
    try {
      const token = localStorage.getItem("token");
      if (txMode === "consume") {
        // C级快速消耗：直接扣库存
        const res = await fetch(`/api/inventory/${txItem.id}/consume`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quantity: txQty, note: txNote || null }),
        });
        if (!res.ok) { const err = await res.json(); alert(err.detail || err.title || "操作失败"); return; }
        alert(`已消耗 ${txQty} 个 ${txItem.name}`);
      } else if (txMode === "checkout") {
        const res = await fetch(`/api/material/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ itemId: txItem.id, quantity: txQty, note: txNote || null }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.detail || data.title || "操作失败"); return; }
        if (data.status === "approved") alert(`${data.grade}级物料，领用成功！`);
        else alert(`${data.grade}级物料，已提交审批，请等待审批结果。`);
      } else if (txMode === "checkin") {
        const res = await fetch(`/api/inventory/${txItem.id}/checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quantity: txQty, note: txNote || null }),
        });
        if (!res.ok) { const err = await res.json(); alert(err.detail || err.title || "操作失败"); return; }
      }
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
  useEffect(() => { api.get<Department[]>("/api/admin/departments").then(setDepartments).catch(() => {}); }, []);
  // 房间下拉从库位布局动态获取，失败回退硬编码列表
  useEffect(() => {
    api.get<{ roomCode: string }[]>("/api/storage/layouts")
      .then(ls => { const rooms = ls.map(l => l.roomCode); if (rooms.length) setRoomOpts(rooms); })
      .catch(() => {});
  }, []);

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

  const openCreate = () => { setEditItem(null); setForm({ name: "", category: "", quantity: 0, grade: "C", unitPrice: 0, departmentId: 0, projectTag: "", locationCode: "" }); setLocRoom(""); setLocCabinet(""); setLocShelf(""); setLocPos(""); setShowForm(true); };
  const openEdit = (i: InventoryItem) => { setEditItem(i); setForm({ name: i.name, category: i.category, quantity: i.quantity, grade: i.grade || "C", unitPrice: i.unitPrice || 0, departmentId: i.departmentId || 0, projectTag: i.projectTag || "", locationCode: i.locationCode || "" }); parseLocCode(i.locationCode || ""); setShowForm(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const locCode = buildLocCode(locRoom, locCabinet, locShelf, locPos) || null;
      if (editItem) await api.put(`/api/inventory/${editItem.id}`, { grade: form.grade, unitPrice: form.unitPrice, departmentId: form.departmentId || null, projectTag: form.projectTag || null, locationCode: locCode });
      else await api.post("/api/inventory", { ...form, locationCode: locCode });
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

  // 领用/消耗与归还的统一入口（原表格内联逻辑抽为回调）
  const handleTake = (item: InventoryItem) => { setTxItem(item); setTxMode(item.grade === "C" ? "consume" : "checkout"); setTxQty(1); setTxNote(""); };
  const handleReturn = (item: InventoryItem) => { setTxItem(item); setTxMode("checkin"); setTxQty(1); setTxNote(""); };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const chartData = categories.map(cat => ({ name: cat || "未分类", value: items.filter(i => i.category === cat).reduce((s, i) => s + i.quantity, 0) }));
  const lowItems = items.filter(i => i.quantity < LOW_THRESHOLD);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h1 className="text-2xl font-bold">零件库存</h1><p className="text-sm text-muted">{items.length} 种 · 共 {totalItems} 件</p></div>
        <div className="flex gap-2">
          {(role === "admin" || role === "部长") && <>
            <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover shadow-sm"><Plus className="h-4 w-4" />添加零件</button>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"><Upload className="h-4 w-4" />导入 Excel<input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} className="hidden" /></label>
          </>}
        </div>
      </div>

      {importMsg && <div className="text-sm p-2 rounded-lg bg-info/10 text-info">{importMsg}</div>}

      {lowItems.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <span className="text-sm text-warning"><strong>{lowItems.length}</strong> 种零件库存不足（低于 {LOW_THRESHOLD} 件）</span>
        </div>
      )}

      <InventoryFilters search={search} onSearch={setSearch} category={category} onCategory={setCategory} categories={categories} />

      <div className="grid gap-4 lg:grid-cols-3">
        <InventoryTable items={items} loading={loading} role={role}
          onTake={handleTake} onReturn={handleReturn} onHistory={fetchHistory} onEdit={openEdit} onDelete={handleDelete} />

        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="font-medium text-sm mb-3">分类分布</h3>
          {chartData.length > 0 ? (
            <><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" label={({ name, value }) => `${name ?? ""} ${value ?? 0}`} labelLine={false}>{chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={2} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            <div className="flex flex-wrap gap-3 justify-center mt-2">{chartData.map((d, i) => <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted"><span className="w-3 h-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{d.name}</div>)}</div></>
          ) : <div className="flex items-center justify-center h-[250px] text-faint text-sm">暂无数据</div>}
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <InventoryFormModal editItem={editItem} form={form} setForm={setForm}
          locRoom={locRoom} setLocRoom={setLocRoom} locCabinet={locCabinet} setLocCabinet={setLocCabinet}
          locShelf={locShelf} setLocShelf={setLocShelf} locPos={locPos} setLocPos={setLocPos}
          roomOpts={roomOpts} departments={departments} buildLocCode={buildLocCode} calcGrade={calcGrade}
          onClose={() => setShowForm(false)} onSubmit={handleSave} />
      )}

      {/* Checkout/Checkin Modal */}
      {txItem && txMode && (
        <InventoryTxModal item={txItem} mode={txMode} qty={txQty} onQty={setTxQty} note={txNote} onNote={setTxNote}
          onClose={() => { setTxItem(null); setTxMode(null); }} onSubmit={handleTransaction} />
      )}

      {/* Transaction History Panel */}
      {showHistory && txItem && (
        <InventoryHistoryPanel item={txItem} history={txHistory} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

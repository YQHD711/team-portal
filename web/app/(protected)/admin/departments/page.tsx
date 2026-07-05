"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, Building2, X } from "lucide-react";

interface Dept { id: number; name: string; description: string; createdAt: string; }

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editDept, setEditDept] = useState<Dept | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(true);

  const fetch = () => {
    api.get<Dept[]>("/api/admin/departments").then(setDepts).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditDept(null); setForm({ name: "", description: "" }); setShowForm(true); };
  const openEdit = (d: Dept) => { setEditDept(d); setForm({ name: d.name, description: d.description }); setShowForm(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editDept) await api.put(`/api/admin/departments/${editDept.id}`, form);
    else await api.post("/api/admin/departments", form);
    setShowForm(false); fetch();
  };

  const handleDelete = async (d: Dept) => {
    if (!confirm(`确认删除部门 "${d.name}"？`)) return;
    await api.delete(`/api/admin/departments/${d.id}`); fetch();
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">部门管理</h1><p className="text-sm text-zinc-500">{depts.length} 个部门</p></div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors shadow-sm"><Plus className="h-4 w-4" />添加部门</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {depts.map(d => (
          <div key={d.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-start justify-between group hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600"><Building2 className="h-5 w-5" /></div>
              <div><div className="font-medium">{d.name}</div><div className="text-sm text-zinc-500 mt-0.5">{d.description || "暂无描述"}</div></div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEdit(d)} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(d)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {loading ? <div className="sm:col-span-2 text-center py-12 text-zinc-400">加载中...</div> :
         depts.length === 0 && <div className="sm:col-span-2 text-center py-12 text-zinc-400"><Building2 className="h-10 w-10 mx-auto mb-2 text-zinc-300" />暂无部门</div>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editDept ? "编辑部门" : "添加部门"}</h2><button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleSave} className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">名称</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required /></div>
              <div><label className="block text-sm font-medium mb-1">描述</label><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 transition-colors">{editDept ? "保存" : "创建"}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

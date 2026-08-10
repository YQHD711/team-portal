"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { X } from "lucide-react";
import { Dept, OrgUser } from "./types";

const inputCls = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

// ── 部门弹窗 ──
export function DeptFormModal({ dept, onClose, onSaved }: { dept: Dept | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dept?.name || "");
  const [description, setDescription] = useState(dept?.description || "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dept) await api.put(`/api/admin/departments/${dept.id}`, { name, description });
    else await api.post("/api/admin/departments", { name, description });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{dept ? "编辑部门" : "添加部门"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-3">
          <div><label className="block text-sm font-medium mb-1">名称</label><input value={name} onChange={e => setName(e.target.value)} className={inputCls} required /></div>
          <div><label className="block text-sm font-medium mb-1">描述</label><input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} /></div>
          <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600">{dept ? "保存" : "创建"}</button>
        </form>
      </div>
    </div>
  );
}

// ── 队员弹窗(添加/编辑角色部门) ──
export function UserFormModal({ user, depts, onClose, onSaved }: { user: OrgUser | null; depts: Dept[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    username: user?.username || "",
    password: "",
    role: user?.role || "member",
    departmentId: user?.departmentId ?? 0,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user) {
      await api.put(`/api/admin/users/${user.id}`, { role: form.role, departmentId: form.departmentId || null, password: form.password || null });
    } else {
      await api.post("/api/admin/users", form);
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{user ? "编辑队员" : "添加队员"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-3">
          <div><label className="block text-sm font-medium mb-1">队员名</label><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className={inputCls} required disabled={!!user} /></div>
          <div><label className="block text-sm font-medium mb-1">密码{user && " (留空不修改)"}</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className={inputCls} required={!user} /></div>
          <div><label className="block text-sm font-medium mb-1">角色</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className={inputCls}>
              <option value="member">成员</option><option value="部长">部长</option><option value="admin">管理员</option>
            </select>
          </div>
          <div><label className="block text-sm font-medium mb-1">部门</label>
            <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: Number(e.target.value) })} className={inputCls}>
              <option value={0}>未分配</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600">{user ? "保存修改" : "创建队员"}</button>
        </form>
      </div>
    </div>
  );
}

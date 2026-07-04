"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, Users, X, Shield, UserCog } from "lucide-react";

interface UserInfo { id: number; username: string; role: string; department: string | null; departmentId: number | null; createdAt: string; }
interface Dept { id: number; name: string; }

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "member", departmentId: 0 });
  const [loading, setLoading] = useState(true);

  const fetchUsers = () => api.get<UserInfo[]>("/api/admin/users").then(setUsers);
  const fetchDepts = () => api.get<Dept[]>("/api/admin/departments").then(setDepts);

  useEffect(() => { Promise.all([fetchUsers(), fetchDepts()]).finally(() => setLoading(false)); }, []);

  const openCreate = () => { setEditUser(null); setForm({ username: "", password: "", role: "member", departmentId: 0 }); setShowForm(true); };
  const openEdit = (u: UserInfo) => { setEditUser(u); setForm({ username: u.username, password: "", role: u.role, departmentId: u.departmentId ?? 0 }); setShowForm(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editUser) {
      await api.put(`/api/admin/users/${editUser.id}`, { role: form.role, departmentId: form.departmentId || null, password: form.password || null });
    } else {
      await api.post("/api/admin/users", form);
    }
    setShowForm(false); fetchUsers();
  };

  const handleDelete = async (u: UserInfo) => {
    if (!confirm(`确认删除用户 "${u.username}"？`)) return;
    try { await api.delete(`/api/admin/users/${u.id}`); fetchUsers(); } catch { alert("无法删除管理员账号"); }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
          <p className="text-sm text-zinc-500">{users.length} 个用户</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> 添加用户
        </button>
      </div>

      {/* User table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">用户名</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">角色</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 hidden sm:table-cell">部门</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 hidden md:table-cell">创建时间</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">操作</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">加载中...</td></tr> :
               users.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400"><Users className="h-8 w-8 mx-auto mb-2 text-zinc-300" />暂无用户</td></tr> :
               users.map(u => (
                <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" :
                      u.role === "部长" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400" :
                      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {u.role === "admin" ? <><Shield className="h-3 w-3 mr-1 inline" />管理员</> :
                       u.role === "部长" ? <><UserCog className="h-3 w-3 mr-1 inline" />部长</> :
                       "成员"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell">{u.department || "—"}</td>
                  <td className="px-4 py-3 text-zinc-400 hidden md:table-cell">{new Date(u.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-sky-600" title="编辑"><Pencil className="h-4 w-4" /></button>
                      {u.role !== "admin" && u.role !== "部长" && <button onClick={() => handleDelete(u)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-600" title="删除"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editUser ? "编辑用户" : "添加用户"}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">用户名</label>
                <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required disabled={!!editUser} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">密码{editUser && " (留空不修改)"}</label>
                <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required={!editUser} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">角色</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="member">成员</option>
                  <option value="部长">部长</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">部门</label>
                <select value={form.departmentId} onChange={e => setForm({...form, departmentId: Number(e.target.value)})} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value={0}>无</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 transition-colors">
                {editUser ? "保存修改" : "创建用户"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

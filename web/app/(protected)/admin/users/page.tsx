"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { Plus, Pencil, Trash2, Users, X, Shield, UserCog, Ticket, Upload, Copy, Check } from "lucide-react";

interface UserInfo { id: number; username: string; role: string; department: string | null; departmentId: number | null; createdAt: string; }
interface Dept { id: number; name: string; }
interface InviteCode { id: number; code: string; departmentId: number | null; department: { name: string } | null; maxUses: number; usedCount: number; isRevoked: boolean; expiresAt: string; createdAt: string; }

export default function UsersPage() {
  // 已合并至组织架构页 /admin/organization
  useEffect(() => { window.location.replace("/admin/organization"); }, []);
  const [tab, setTab] = useState<string>("users");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "member", departmentId: 0 });
  const [loading, setLoading] = useState(true);

  // Invite codes
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ departmentId: 0, maxUses: 1, daysValid: 7 });
  const [copied, setCopied] = useState("");

  // CSV
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvMsg, setCsvMsg] = useState("");

  const fetchUsers = () => api.get<UserInfo[]>("/api/admin/users").then(setUsers);
  const fetchDepts = () => api.get<Dept[]>("/api/admin/departments").then(setDepts);
  const fetchInvites = () => api.get<InviteCode[]>("/api/admin/invite-codes").then(setInvites);

  useEffect(() => { Promise.all([fetchUsers(), fetchDepts()]).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (tab === "invites") fetchInvites(); }, [tab]);

  const openCreate = () => { setEditUser(null); setForm({ username: "", password: "", role: "member", departmentId: 0 }); setShowForm(true); };
  const openEdit = (u: UserInfo) => { setEditUser(u); setForm({ username: u.username, password: "", role: u.role, departmentId: u.departmentId ?? 0 }); setShowForm(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editUser) await api.put(`/api/admin/users/${editUser.id}`, { role: form.role, departmentId: form.departmentId || null, password: form.password || null });
    else await api.post("/api/admin/users", form);
    setShowForm(false); fetchUsers();
  };

  const handleDelete = async (u: UserInfo) => {
    if (!confirm(`确认删除队员 "${u.username}"？`)) return;
    try { await api.delete(`/api/admin/users/${u.id}`); fetchUsers(); } catch { alert("无法删除管理员账号"); }
  };

  const generateInvite = async () => {
    await api.post("/api/admin/invite-codes", inviteForm);
    setShowInviteForm(false); fetchInvites();
  };

  const revokeInvite = async (id: number) => {
    await api.post(`/api/admin/invite-codes/${id}/revoke`, {});
    fetchInvites();
  };

  const handleCsvImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const token = localStorage.getItem("token");
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/admin/users/import-csv?password=team123`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const data = await res.json();
    setCsvMsg(data.message || `导入完成: ${data.imported} 人`);
    fetchUsers();
  };

  const tabs = [
    { key: "users", label: "队员列表" },
    { key: "invites", label: "邀请码" },
    { key: "import", label: "批量导入" },
  ];

  const copyCode = (code: string) => { copyText(code); setCopied(code); setTimeout(() => setCopied(""), 2000); };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">队员管理</h1>
          <p className="text-sm text-muted">{users.length} 名队员</p>
        </div>
        {tab === "users" && <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"><Plus className="h-4 w-4"/>添加队员</button>}
        {tab === "invites" && <button onClick={() => setShowInviteForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"><Ticket className="h-4 w-4"/>生成邀请码</button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?"bg-surface shadow-sm":"text-muted"}`}>{t.label}</button>
        ))}
      </div>

      {/* User table */}
      {tab === "users" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-background">
                <th className="px-4 py-3 text-left font-medium text-muted">队员名</th><th className="px-4 py-3 text-left font-medium text-muted">角色</th><th className="px-4 py-3 text-left font-medium text-muted hidden sm:table-cell">部门</th><th className="px-4 py-3 text-left font-medium text-muted hidden md:table-cell">创建时间</th><th className="px-4 py-3 text-right font-medium text-muted">操作</th>
              </tr></thead>
              <tbody className="divide-y divide-border-subtle">
                {loading ? <tr><td colSpan={5} className="px-4 py-12 text-center text-faint">加载中...</td></tr> :
                 users.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-faint"><Users className="h-8 w-8 mx-auto mb-2 text-zinc-300"/>暂无队员</td></tr> :
                 users.map(u => (
                  <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950">
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.role==="admin"?"bg-purple-100 text-purple-700":u.role==="部长"?"bg-sky-100 text-sky-700":"bg-zinc-100 text-zinc-600"}`}>{u.role==="admin"?<><Shield className="h-3 w-3 mr-1 inline"/>管理员</>:u.role==="部长"?<><UserCog className="h-3 w-3 mr-1 inline"/>部长</>:"成员"}</span></td>
                    <td className="px-4 py-3 text-muted hidden sm:table-cell">{u.department||"—"}</td>
                    <td className="px-4 py-3 text-faint hidden md:table-cell">{new Date(u.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1"><button onClick={()=>openEdit(u)} className="p-1.5 rounded hover:bg-surface-hover text-faint hover:text-sky-600" title="编辑"><Pencil className="h-4 w-4"/></button>{u.role!=="admin"&&u.role!=="部长"&&<button onClick={()=>handleDelete(u)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger" title="删除"><Trash2 className="h-4 w-4"/></button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite codes */}
      {tab === "invites" && (
        <div className="rounded-xl border border-border bg-surface divide-y">
          {invites.length === 0 ? <div className="p-12 text-center text-faint"><Ticket className="h-8 w-8 mx-auto mb-2 text-zinc-300"/><p>暂无邀请码</p></div> :
          invites.map(c => (
            <div key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <code className="text-lg font-mono font-bold tracking-wider">{c.code}</code>
                  <button onClick={()=>copyCode(c.code)} className="p-1 rounded hover:bg-zinc-100 text-faint">{copied===c.code?<Check className="h-3.5 w-3.5 text-success"/>:<Copy className="h-3.5 w-3.5"/>}</button>
                  {c.isRevoked && <span className="text-xs text-danger bg-red-50 px-2 py-0.5 rounded-full">已作废</span>}
                </div>
                <div className="text-xs text-faint mt-1">
                  部门: {c.department?.name || "不限"} · 使用: {c.usedCount}/{c.maxUses} · 过期: {new Date(c.expiresAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
              {!c.isRevoked && <button onClick={()=>revokeInvite(c.id)} className="text-xs text-danger hover:underline">作废</button>}
            </div>
          ))}
        </div>
      )}

      {/* CSV Import */}
      {tab === "import" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">上传 CSV 文件</label>
            <p className="text-xs text-faint mb-2">CSV 格式：队员名,部门名（部门名为可选列，不存在则忽略）</p>
            <input ref={fileRef} type="file" accept=".csv" className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-sky-50 file:text-sky-700"/>
          </div>
          <button onClick={handleCsvImport} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"><Upload className="h-4 w-4"/>导入队员</button>
          {csvMsg && <div className={`text-sm p-2 rounded-lg ${csvMsg.includes("成功")?"bg-green-50 text-green-700":"bg-red-50 text-danger"}`}>{csvMsg}</div>}
        </div>
      )}

      {/* User form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={()=>setShowForm(false)}>
          <div className="w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editUser?"编辑队员":"添加队员"}</h2><button onClick={()=>setShowForm(false)} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5"/></button></div>
            <form onSubmit={handleSave} className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">队员名</label><input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" required disabled={!!editUser}/></div>
              <div><label className="block text-sm font-medium mb-1">密码{editUser&&" (留空不修改)"}</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" required={!editUser}/></div>
              <div><label className="block text-sm font-medium mb-1">角色</label><select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="member">成员</option><option value="部长">部长</option><option value="admin">管理员</option></select></div>
              <div><label className="block text-sm font-medium mb-1">部门</label><select value={form.departmentId} onChange={e=>setForm({...form,departmentId:Number(e.target.value)})} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value={0}>无</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">{editUser?"保存修改":"创建队员"}</button>
            </form>
          </div>
        </div>
      )}

      {/* Invite form modal */}
      {showInviteForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={()=>setShowInviteForm(false)}>
          <div className="w-full max-w-sm my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border p-6" onClick={e=>e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">生成邀请码</h2>
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">部门（可选）</label><select value={inviteForm.departmentId} onChange={e=>setInviteForm({...inviteForm,departmentId:Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm"><option value={0}>不限</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">最大使用次数</label><input type="number" value={inviteForm.maxUses} onChange={e=>setInviteForm({...inviteForm,maxUses:parseInt(e.target.value)||1})} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div><label className="block text-sm font-medium mb-1">有效期(天)</label><input type="number" value={inviteForm.daysValid} onChange={e=>setInviteForm({...inviteForm,daysValid:parseInt(e.target.value)||7})} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
            </div>
            <div className="flex gap-2 mt-4 justify-end"><button onClick={()=>setShowInviteForm(false)} className="px-4 py-2 rounded-lg text-sm border">取消</button><button onClick={generateInvite} className="px-4 py-2 rounded-lg text-sm bg-primary text-white">生成</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

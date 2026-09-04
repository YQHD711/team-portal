"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { Ticket, Plus, X, Copy, Check } from "lucide-react";
import { Dept } from "./types";

interface InviteCode { id: number; code: string; departmentId: number | null; department: { name: string } | null; maxUses: number; usedCount: number; isRevoked: boolean; expiresAt: string; createdAt: string; }

export function InvitesTab({ depts, onChanged }: { depts: Dept[]; onChanged: () => void }) {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ departmentId: 0, maxUses: 1, daysValid: 7 });
  const [copied, setCopied] = useState("");

  const fetchInvites = () => api.get<InviteCode[]>("/api/admin/invite-codes").then(setInvites);
  useEffect(() => { fetchInvites(); }, []);

  const generate = async () => {
    await api.post("/api/admin/invite-codes", form);
    setShowForm(false); fetchInvites();
  };

  const revoke = async (id: number) => {
    await api.post(`/api/admin/invite-codes/${id}/revoke`, {});
    fetchInvites();
  };

  const remove = async (id: number) => {
    await api.delete(`/api/admin/invite-codes/${id}`);
    fetchInvites();
  };

  const copyCode = (code: string) => { copyText(code); setCopied(code); setTimeout(() => setCopied(""), 2000); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          <Ticket className="h-4 w-4" />生成邀请码
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface divide-y">
        {invites.length === 0 ? (
          <div className="p-12 text-center text-faint"><Ticket className="h-8 w-8 mx-auto mb-2 text-zinc-300" /><p>暂无邀请码</p></div>
        ) : invites.map(c => (
          <div key={c.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold tracking-wider">{c.code}</code>
                <button onClick={() => copyCode(c.code)} className="p-1 rounded hover:bg-zinc-100 text-faint">{copied === c.code ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</button>
                {c.isRevoked && <span className="text-xs text-danger bg-red-50 px-2 py-0.5 rounded-full">已作废</span>}
              </div>
              <div className="text-xs text-faint mt-1">
                部门: {c.department?.name || "不限"} · 使用: {c.usedCount}/{c.maxUses} · 过期: {new Date(c.expiresAt).toLocaleDateString("zh-CN")}
              </div>
            </div>
            {!c.isRevoked && <button onClick={() => revoke(c.id)} className="text-xs text-danger hover:underline">作废</button>}
            {c.isRevoked && <button onClick={() => remove(c.id)} className="text-xs text-muted hover:underline">删除</button>}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-sm my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">生成邀请码</h2>
            <div className="space-y-3">
              <div><label className="block text-sm font-medium mb-1">部门（可选）</label>
                <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: Number(e.target.value) })} className="w-full rounded-lg border px-3 py-2 text-sm">
                  <option value={0}>不限</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">最大使用次数</label><input type="number" value={form.maxUses} onChange={e => setForm({ ...form, maxUses: parseInt(e.target.value) || 1 })} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">有效期(天)</label><input type="number" value={form.daysValid} onChange={e => setForm({ ...form, daysValid: parseInt(e.target.value) || 7 })} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border">取消</button>
              <button onClick={generate} className="px-4 py-2 rounded-lg text-sm bg-primary text-white">生成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

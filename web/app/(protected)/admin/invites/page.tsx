"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Ticket, Plus, X, Copy, Clock, Loader2 } from "lucide-react";

interface InviteCode {
  id: number; code: string; departmentId: number | null;
  departmentName: string | null; maxUses: number | null; useCount: number;
  daysValid: number | null; expiresAt: string | null; isRevoked: boolean;
  createdAt: string; createdBy: string;
}

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deptId, setDeptId] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [daysValid, setDaysValid] = useState("30");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState("");

  const fetchCodes = () => {
    api.get<InviteCode[]>("/api/admin/invite-codes").then(setCodes).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { fetchCodes(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      await api.post("/api/admin/invite-codes", {
        departmentId: deptId ? parseInt(deptId) : null,
        maxUses: maxUses ? parseInt(maxUses) : null,
        daysValid: parseInt(daysValid) || 30,
      });
      setShowForm(false); setDeptId(""); setMaxUses(""); fetchCodes();
    } catch (err) { alert(err instanceof Error ? err.message : "生成失败"); }
    finally { setGenerating(false); }
  };

  const revoke = async (id: number) => {
    if (!confirm("确定作废此邀请码？")) return;
    await api.post(`/api/admin/invite-codes/${id}/revoke`, {});
    fetchCodes();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">邀请码管理</h1>
          <p className="text-sm text-muted">为队员生成注册邀请码</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          <Plus className="h-4 w-4" />生成邀请码
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border p-4 space-y-3 bg-surface">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">归属部门</label>
              <select value={deptId} onChange={e => setDeptId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="">不限</option>
                <option value="1">飞训部</option>
                <option value="2">电子部</option>
                <option value="3">工程部</option>
                <option value="4">办公室</option>
                <option value="5">集群部</option>
                <option value="6">文创部</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">最大使用次数</label>
              <input type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="不限"
                className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">有效期(天)</label>
              <input type="number" value={daysValid} onChange={e => setDaysValid(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border">取消</button>
            <button onClick={generate} disabled={generating} className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover disabled:opacity-50">
              {generating ? "生成中..." : "确认生成"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-surface divide-y">
        {codes.length === 0 ? (
          <div className="p-12 text-center text-faint">
            <Ticket className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>暂无邀请码</p>
          </div>
        ) : codes.map(c => (
          <div key={c.id} className={`p-4 flex items-center justify-between ${c.isRevoked ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-3">
              <Ticket className={`h-8 w-8 ${c.isRevoked ? "text-zinc-300" : "text-sky-500"}`} />
              <div>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono font-bold bg-surface-subtle px-2 py-0.5 rounded">{c.code}</code>
                  <button onClick={() => { navigator.clipboard.writeText(c.code); setCopied(c.code); setTimeout(() => setCopied(""), 2000); }}
                    className="text-faint hover:text-sky-500" title="复制">
                    {copied === c.code ? <span className="text-xs text-success">已复制</span> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="text-xs text-faint mt-1 space-x-3">
                  <span>使用 {c.useCount}{c.maxUses ? `/${c.maxUses}` : ""} 次</span>
                  {c.departmentName && <span>归属: {c.departmentName}</span>}
                  {c.expiresAt && <span>过期: {new Date(c.expiresAt).toLocaleDateString("zh-CN")}</span>}
                  <span>创建: {new Date(c.createdAt).toLocaleDateString("zh-CN")}</span>
                </div>
              </div>
            </div>
            {!c.isRevoked && (
              <button onClick={() => revoke(c.id)} className="p-2 rounded-lg hover:bg-red-50 text-danger text-sm">
                <X className="h-4 w-4" />作废
              </button>
            )}
            {c.isRevoked && <span className="text-xs text-faint bg-surface-subtle px-2 py-1 rounded">已作废</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

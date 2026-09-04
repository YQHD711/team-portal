"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

interface Dept { id: number; name: string; }
interface Exam { id: number; departmentId: number; title: string; examType: string; status: string; examDate: string | null; }

const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

const TEMPLATES = [
  { label: "理论考核", title: "2026秋季理论考核", examType: "theory" },
  { label: "实操考核", title: "焊接实操考核", examType: "practice" },
  { label: "安全认证", title: "安全认证", examType: "theory" },
];

interface Props {
  depts: Dept[];
  exam: Exam | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export default function ExamFormModal({ depts, exam, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    title: exam?.title ?? "",
    examType: exam?.examType ?? "theory",
    status: exam?.status ?? "ongoing",
    examDate: (exam?.examDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
  });
  const [deptId, setDeptId] = useState(exam?.departmentId ?? depts[0]?.id ?? 0);
  const [selDepts, setSelDepts] = useState<Set<number>>(new Set(depts.map(d => d.id)));
  const [saving, setSaving] = useState(false);

  const allSel = depts.length > 0 && selDepts.size === depts.length;
  const toggleDept = (id: number) =>
    setSelDepts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleAll = () => setSelDepts(allSel ? new Set() : new Set(depts.map(d => d.id)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (!exam && selDepts.size === 0) return alert("请至少选择一个部门");
    if (saving) return;
    setSaving(true);
    try {
      const body = { title: form.title.trim(), examType: form.examType, status: form.status, examDate: form.examDate || null };
      if (exam) {
        await api.put(`/api/admin/exams/${exam.id}`, { ...body, departmentId: deptId });
        onSaved("考核已更新");
      } else {
        for (const d of [...selDepts]) {
          await api.post("/api/admin/exams", { ...body, departmentId: d });
        }
        onSaved(`已创建 ${selDepts.size} 场考核`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{exam ? "编辑考核" : "创建考核"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {!exam && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5">常用模板</label>
                <div className="flex gap-2 flex-wrap">
                  {TEMPLATES.map(t => (
                    <button key={t.label} type="button"
                      onClick={() => setForm(f => ({ ...f, title: t.title, examType: t.examType }))}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-sky-500 hover:text-sky-600">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">部门 * <span className="text-xs text-faint">(可多选, 批量创建同名考核)</span></label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-border p-3 max-h-40 overflow-y-auto">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={allSel} onChange={toggleAll} className="h-4 w-4 rounded" />全选
                  </label>
                  {depts.map(d => (
                    <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={selDepts.has(d.id)} onChange={() => toggleDept(d.id)} className="h-4 w-4 rounded" />{d.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          {exam && (
            <div>
              <label className="block text-sm font-medium mb-1">部门 *</label>
              <select value={deptId} onChange={e => setDeptId(Number(e.target.value))} className={inputCls}>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div><label className="block text-sm font-medium mb-1">考核名称 *</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="如: 2026秋季理论考核 / 焊接实操" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1">类型</label>
              <select value={form.examType} onChange={e => setForm({ ...form, examType: e.target.value })} className={inputCls}>
                <option value="theory">理论</option><option value="practice">实操</option>
              </select>
            </div>
            <div><label className="block text-sm font-medium mb-1">状态</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
                <option value="ongoing">进行中</option><option value="completed">已完成</option>
              </select>
            </div>
          </div>
          <div><label className="block text-sm font-medium mb-1">考核日期</label><input type="date" value={form.examDate} onChange={e => setForm({ ...form, examDate: e.target.value })} className={inputCls} /></div>
          <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {exam ? "保存" : `创建${selDepts.size > 1 ? ` ${selDepts.size} 场` : ""}`}
          </button>
        </form>
      </div>
    </div>
  );
}

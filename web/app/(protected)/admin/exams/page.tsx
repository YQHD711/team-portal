"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import ExamFormModal from "@/components/admin/exams/ExamFormModal";
import ResultsPanel from "@/components/admin/exams/ResultsPanel";
import BatchTrainingPanel from "@/components/admin/training/BatchTrainingPanel";

interface Exam { id: number; departmentId: number; department: string | null; title: string; examType: string; status: string; examDate: string | null; resultCount: number; passedCount: number; }
interface Dept { id: number; name: string; }
interface UserInfo { id: number; username: string; }

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editExam, setEditExam] = useState<Exam | null>(null);
  const [openResults, setOpenResults] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    Promise.all([
      api.get<Exam[]>("/api/admin/exams").then(setExams),
      api.get<Dept[]>("/api/admin/departments").then(setDepts),
      api.get<UserInfo[]>("/api/admin/users").then(setUsers),
    ]).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const openCreate = () => { setEditExam(null); setShowForm(true); };
  const openEdit = (e: Exam) => { setEditExam(e); setShowForm(true); };

  const onSaved = (msg: string) => { alert(msg); setShowForm(false); refresh(); };

  // ── 批量操作 ──
  const allSelected = exams.length > 0 && selected.size === exams.length;
  const toggleSelect = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(exams.map(e => e.id)));

  const markCompleted = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) await api.put(`/api/admin/exams/${id}`, { status: "completed" });
      alert(`已将 ${ids.length} 场考核标记为已完成`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally { setBusy(false); setSelected(new Set()); refresh(); }
  };

  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`确认删除选中的 ${ids.length} 场考核？其成绩记录将一并删除`)) return;
    setBusy(true);
    try {
      for (const id of ids) await api.delete(`/api/admin/exams/${id}`);
      alert(`已删除 ${ids.length} 场考核`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false); setSelected(new Set());
      if (ids.includes(openResults as number)) setOpenResults(null);
      refresh();
    }
  };

  const remove = async (e: Exam) => {
    if (!confirm(`确认删除考核 "${e.title}"？其成绩记录将一并删除`)) return;
    await api.delete(`/api/admin/exams/${e.id}`);
    setSelected(prev => { const next = new Set(prev); next.delete(e.id); return next; });
    if (openResults === e.id) setOpenResults(null);
    refresh();
  };

  const groups = depts.map(d => ({ dept: d, items: exams.filter(e => e.departmentId === d.id) })).filter(g => g.items.length > 0);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">考核管理</h1>
          <p className="text-sm text-muted">部门考核任务与成绩记录 · {exams.length} 场考核</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          <Plus className="h-4 w-4" />创建考核
        </button>
      </div>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-12 text-center text-faint">
          <ClipboardCheck className="h-10 w-10 mx-auto mb-2 text-zinc-300" /><p>暂无考核</p>
        </div>
      ) : (
        <>
          {/* 培训批量录入(独立于考核列表) */}
          <BatchTrainingPanel users={users} onSaved={(msg) => alert(msg)} />

          {/* 批量操作工具条 */}
          <div className="rounded-xl border border-border bg-surface px-4 py-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded" />全选本页
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted">{selected.size} 项已选</span>
                <button onClick={markCompleted} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success disabled:opacity-60">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}标记已完成
                </button>
                <button onClick={batchDelete} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger disabled:opacity-60">
                  <Trash2 className="h-3.5 w-3.5" />删除
                </button>
                <button onClick={() => setSelected(new Set())} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">取消</button>
              </div>
            )}
          </div>

          {groups.map(({ dept, items }) => (
            <div key={dept.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold">{dept.name}</span>
                <span className="text-xs text-faint">{items.length} 场</span>
              </div>
              <div className="space-y-3 mb-5">
                {items.map(e => (
                  <div key={e.id} className="rounded-xl border border-border bg-surface overflow-hidden">
                    <div className="p-4 flex items-start gap-3">
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} className="mt-1 h-4 w-4 rounded shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{e.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${e.examType === "practice" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>{e.examType === "practice" ? "实操" : "理论"}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${e.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{e.status === "completed" ? "已完成" : "进行中"}</span>
                        </div>
                        <div className="text-xs text-faint mt-1">
                          {e.examDate ? new Date(e.examDate).toLocaleDateString("zh-CN") : "未定日期"}
                          {e.resultCount > 0 && <> · 通过 {e.passedCount}/{e.resultCount} 人</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setOpenResults(openResults === e.id ? null : e.id)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border hover:bg-surface-hover">
                          {openResults === e.id ? <><ChevronUp className="h-3.5 w-3.5" />收起</> : <><ChevronDown className="h-3.5 w-3.5" />成绩 ({e.resultCount})</>}
                        </button>
                        <button onClick={() => openEdit(e)} className="p-1.5 rounded hover:bg-surface-hover text-faint hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => remove(e)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    {openResults === e.id && <ResultsPanel examId={e.id} users={users} onChanged={refresh} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {showForm && <ExamFormModal depts={depts} exam={editExam} onClose={() => setShowForm(false)} onSaved={onSaved} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";

interface ExamResult { id: number; examId: number; userId: number; username: string; passed: boolean; score: number | null; notes: string | null; }
interface UserInfo { id: number; username: string; }

const inputCls = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

interface Props {
  examId: number;
  users: UserInfo[];
  onChanged: () => void;
}

export default function ResultsPanel({ examId, users, onChanged }: Props) {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 录入区:未录入队员多选 + 统一值
  const [selUsers, setSelUsers] = useState<Set<number>>(new Set());
  const [passed, setPassed] = useState(true);
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  // 已录入列表:多选删除
  const [selResults, setSelResults] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try { setResults(await api.get<ExamResult[]>(`/api/admin/exams/${examId}/results`)); }
    catch { setResults([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [examId]);

  const available = users.filter(u => !results.some(r => r.userId === u.id));

  const toggleUser = (id: number) =>
    setSelUsers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleAllUsers = () =>
    setSelUsers(selUsers.size === available.length && available.length > 0 ? new Set() : new Set(available.map(u => u.id)));
  const toggleResult = (id: number) =>
    setSelResults(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const submitBatch = async () => {
    if (selUsers.size === 0) return alert("请先选择队员");
    setBusy(true);
    try {
      await api.post(`/api/admin/exams/${examId}/results`, [...selUsers].map(userId => ({
        userId, passed, score: score ? parseFloat(score) : null, notes: notes || null,
      })));
      setSelUsers(new Set()); setScore(""); setNotes("");
      await load();
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "录入失败");
    } finally { setBusy(false); }
  };

  const deleteSelected = async () => {
    if (selResults.size === 0) return;
    if (!confirm(`确定删除所选 ${selResults.size} 条成绩记录？`)) return;
    setBusy(true);
    try {
      for (const rid of [...selResults]) await api.delete(`/api/admin/exams/${examId}/results/${rid}`);
      setSelResults(new Set());
      await load();
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-4">
      {/* 批量录入区 */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">选择队员 * <span className="text-xs text-zinc-400">(已录入的不再显示, 可多选批量录入)</span></label>
        {available.length === 0 ? (
          <p className="text-sm text-zinc-400">全部队员均已录入成绩</p>
        ) : (
          <div className="max-h-36 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={available.length > 0 && selUsers.size === available.length} onChange={toggleAllUsers} className="h-4 w-4 rounded" />全选
            </label>
            {available.map(u => (
              <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selUsers.has(u.id)} onChange={() => toggleUser(u.id)} className="h-4 w-4 rounded" />{u.username}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">是否通过</label>
            <select value={passed ? "1" : "0"} onChange={ev => setPassed(ev.target.value === "1")} className={inputCls}>
              <option value="1">通过</option><option value="0">未通过</option>
            </select>
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium mb-1">分数(可选)</label>
            <input type="number" step="0.5" value={score} onChange={ev => setScore(ev.target.value)} className={inputCls} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium mb-1">备注</label>
            <input value={notes} onChange={ev => setNotes(ev.target.value)} className={inputCls} />
          </div>
          <button onClick={submitBatch} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-60">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            批量录入{selUsers.size > 0 ? ` (${selUsers.size}人)` : ""}
          </button>
        </div>
      </div>

      {/* 已录入列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">已录入成绩 ({results.length})</span>
          {selResults.size > 0 && (
            <button onClick={deleteSelected} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-red-50 dark:bg-red-950 text-red-600 hover:bg-red-100 disabled:opacity-60">
              <Trash2 className="h-3.5 w-3.5" />删除所选 ({selResults.size})
            </button>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : results.length === 0 ? (
          <div className="text-center py-6 text-sm text-zinc-400">暂无成绩记录</div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            {results.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={selResults.has(r.id)} onChange={() => toggleResult(r.id)} className="h-4 w-4 rounded shrink-0" />
                  <span className="font-medium">{r.username}</span>
                  {r.passed ? <Check className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-400" />}
                  {r.score !== null && r.score !== undefined && <span className="text-zinc-500">{r.score}分</span>}
                  {r.notes && <span className="text-xs text-zinc-400 truncate">{r.notes}</span>}
                </div>
                <button onClick={() => { if (confirm("确定删除此成绩记录？")) { api.delete(`/api/admin/exams/${examId}/results/${r.id}`).then(() => { load(); onChanged(); }); } }} className="p-1 rounded hover:bg-red-50 text-zinc-400 hover:text-red-600 shrink-0"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

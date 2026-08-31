"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, GraduationCap, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface UserInfo { id: number; username: string; }

const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

interface Props {
  users: UserInfo[];
  onSaved?: (msg: string) => void;
}

export default function BatchTrainingPanel({ users, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [selUsers, setSelUsers] = useState<Set<number>>(new Set());
  const [courseName, setCourseName] = useState("");
  const [examDate, setExamDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [score, setScore] = useState("");
  const [examiner, setExaminer] = useState("");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ count: number; course: string } | null>(null);

  // 已在本批次添加过课程名的用户(可选:上次添加的去重提示)。当前策略:不阻止,允许同一人多次上同一课(不同时间)。
  const toggle = (id: number) => setSelUsers(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelUsers(selUsers.size === users.length ? new Set() : new Set(users.map(u => u.id)));

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? users.filter(u => u.username.toLowerCase().includes(q)) : users;
  }, [filter, users]);

  const reset = () => { setSelUsers(new Set()); setScore(""); setExaminer(""); setNotes(""); };
  const submit = async () => {
    if (!courseName.trim()) return alert("课程名称不能为空");
    if (selUsers.size === 0) return alert("请至少选择一位队员");
    setBusy(true);
    try {
      const res = await api.post<{ count: number; message: string }>("/api/admin/training/batch", {
        userIds: [...selUsers], courseName: courseName.trim(), examDate,
        score: score ? parseFloat(score) : null, examiner: examiner.trim() || null, notes: notes.trim() || null,
      });
      setLastResult({ count: res.count, course: courseName.trim() });
      reset();
      onSaved?.(res.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "录入失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors">
        <div className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-sky-500" /><span className="text-sm font-semibold">批量录入培训</span>
          {lastResult && <span className="text-xs text-success">· 上次已录入 {lastResult.count} 人 "{lastResult.course}"</span>}</div>
        <ChevronDown className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border bg-background/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1"><label className="block text-xs font-medium mb-1">课程名称 *</label><input value={courseName} onChange={ev => setCourseName(ev.target.value)} className={inputCls} placeholder="如 PX4 入门" /></div>
            <div><label className="block text-xs font-medium mb-1">上课日期 *</label><input type="date" value={examDate} onChange={ev => setExamDate(ev.target.value)} className={inputCls} /></div>
            <div><label className="block text-xs font-medium mb-1">分数(可选)</label><input type="number" step="0.5" value={score} onChange={ev => setScore(ev.target.value)} className={inputCls} placeholder="如 85.5" /></div>
            <div><label className="block text-xs font-medium mb-1">考核员</label><input value={examiner} onChange={ev => setExaminer(ev.target.value)} className={inputCls} placeholder="教练姓名" /></div>
            <div className="sm:col-span-2"><label className="block text-xs font-medium mb-1">备注</label><input value={notes} onChange={ev => setNotes(ev.target.value)} className={inputCls} placeholder="课程内容/重点..." /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium">选择队员 * <span className="text-faint">已选 {selUsers.size} 人</span></label>
              <input value={filter} onChange={ev => setFilter(ev.target.value)} placeholder="搜索用户名..." className="w-32 rounded border border-border bg-surface px-2 py-1 text-xs" />
            </div>
            <div className="max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface p-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={filtered.length > 0 && filtered.every(u => selUsers.has(u.id))} onChange={toggleAll} className="h-4 w-4 rounded" />全选{filter && "(筛后)"}
              </label>
              {filtered.map(u => (
                <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={selUsers.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 rounded" />{u.username}
                </label>
              ))}
              {filtered.length === 0 && <span className="col-span-full text-xs text-faint py-2 text-center">无匹配</span>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={reset} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-60">清空</button>
            <button onClick={submit} disabled={busy || !courseName.trim() || selUsers.size === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}批量录入{selUsers.size > 0 ? ` (${selUsers.size}人)` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
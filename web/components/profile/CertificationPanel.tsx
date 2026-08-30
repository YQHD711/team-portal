"use client";

import { BadgeCheck, ClipboardCheck, Loader2 } from "lucide-react";

export interface ExamPassView {
  id: number; userId: number; username: string;
  examId: number; examTitle: string;
  examType: string; examDate: string | null;
  score: number | null; notes: string | null;
}

/**
 * 团队认证面板(只读):展示该队员「考核通过」记录。
 * 认证只能由管理员/部长通过发起考核 → 录入通过成绩自动产生,无手动添加入口。
 */
export function CertificationPanel({ items, loading = false }: { items: ExamPassView[]; loading?: boolean }) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-faint" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-faint flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" />认证由管理员/部长发起考核并通过后自动获得</p>

      <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
        {items.length === 0 ? (
          <div className="p-12 text-center text-faint">
            <BadgeCheck className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>暂无认证记录</p>
            <p className="text-xs mt-1">通过部门考核后自动展示在此处</p>
          </div>
        ) : items.map(p => (
          <div key={p.id} className="p-4 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
                <ClipboardCheck className="h-3 w-3" />{p.examTitle}
              </span>
              {p.score != null && <span className="text-xs text-muted">{p.score}分</span>}
            </div>
            <div className="text-xs text-faint shrink-0">
              {p.examDate ? new Date(p.examDate).toLocaleDateString("zh-CN") : "未定日期"}
              {p.notes && ` · ${p.notes}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

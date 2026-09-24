"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Loader2, Users, X } from "lucide-react";
import type { StudyStats } from "@/lib/studyNav";

/**
 * 部门完成情况（部长看本部门，管理员看全部）。
 *
 * 这是「进度存服务端」换来的东西 —— localStorage 版本做不出这个，
 * 因为那只是一个浏览器里的勾选，别人看不到、也不可信。
 */
export function StudyStatsPanel({ scope, onClose }: { scope: string; onClose: () => void }) {
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<StudyStats>(`/api/study/stats?scope=${encodeURIComponent(scope)}`)
      .then(s => { if (!cancelled) setStats(s); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const members = stats?.memberCount ?? 0;

  return (
    <section className="rounded-2xl border bg-surface p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-sky-500" />
        <h3 className="text-sm font-bold">{scope === "公共" ? "全队完成情况" : `${scope}完成情况`}</h3>
        <span className="text-xs text-faint">{members} 人</span>
        <button onClick={onClose} className="ml-auto text-faint hover:text-foreground" aria-label="关闭完成情况">
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-faint" /></div>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {(stats?.lessons ?? []).map(l => {
            const p = members > 0 ? Math.round((l.completedCount / members) * 100) : 0;
            return (
              <div key={l.path} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 truncate text-muted">{l.title}</span>
                <div className="w-28 h-1.5 rounded-full bg-surface-subtle overflow-hidden shrink-0">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${p}%` }} />
                </div>
                <span className="text-xs text-faint w-16 text-right shrink-0">{l.completedCount} / {members} 人</span>
              </div>
            );
          })}
          {(stats?.lessons ?? []).length === 0 && <p className="text-sm text-faint py-3">这个范围还没有课时</p>}
        </div>
      )}
    </section>
  );
}

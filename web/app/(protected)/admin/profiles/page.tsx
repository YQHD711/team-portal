"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { User, Search, Loader2, Clock, TrendingUp } from "lucide-react";

const LEVEL_COLORS: Record<string, string> = {
  "学员": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "初级": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "中级": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "高级": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "教练": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

interface ProfileSummary {
  id: number; userId: number; username: string; department: string | null;
  level: string; totalFlightHours: number; firstFlightDate: string | null; updatedAt: string;
}

export default function AdminProfilesPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<ProfileSummary[]>("/api/admin/profiles").then(setProfiles).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = profiles.filter(p =>
    !search || p.username.toLowerCase().includes(search.toLowerCase()) ||
    (p.department && p.department.includes(search))
  );

  // Group by level
  const grouped: Record<string, ProfileSummary[]> = {};
  for (const p of filtered) {
    const lvl = p.level || "学员";
    if (!grouped[lvl]) grouped[lvl] = [];
    grouped[lvl].push(p);
  }
  const levelOrder = ["教练", "高级", "中级", "初级", "学员"];

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">队员档案</h1>
        <p className="text-sm text-zinc-500">管理所有队员的飞手等级、培训与参赛记录</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {levelOrder.filter(l => grouped[l]).map(lvl => (
          <div key={lvl} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[lvl]}`}>{lvl}</span>
              <span className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">{grouped[lvl].length}</span>
            </div>
            <div className="text-xs text-zinc-400 mt-2">
              平均飞行 {Math.round(grouped[lvl].reduce((s, p) => s + p.totalFlightHours, 0) / grouped[lvl].length)} 小时
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索队员姓名或部门..."
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30" />
      </div>

      {/* Grouped list */}
      {levelOrder.map(lvl => {
        const items = grouped[lvl];
        if (!items) return null;
        return (
          <div key={lvl}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[lvl]}`}>{lvl}</span>
              <span className="text-xs text-zinc-400">{items.length} 人</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(p => (
                <Link key={p.userId} href={`/admin/profiles/${p.userId}`}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {p.username[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.username}</div>
                      <div className="text-xs text-zinc-400">{p.department || "未分配部门"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" />{p.totalFlightHours}h</span>
                    {p.firstFlightDate && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(p.firstFlightDate).toLocaleDateString("zh-CN")}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-zinc-400">
          <User className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
          <p>暂无队员档案</p>
        </div>
      )}
    </div>
  );
}

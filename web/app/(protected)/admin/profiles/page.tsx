"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { User, Search, Loader2, BadgeCheck } from "lucide-react";

interface UserInfo { id: number; username: string; role: string; department: string | null; departmentId: number | null; }
interface ProfileBrief { userId: number; skills: string | null; }
interface Certification { id: number; userId: number; certName: string; level: string; status: string; }
interface Dept { id: number; name: string; }

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  部长: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  member: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export default function AdminProfilesPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [profiles, setProfiles] = useState<ProfileBrief[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<UserInfo[]>("/api/admin/users").then(setUsers),
      api.get<Dept[]>("/api/admin/departments").then(setDepts),
      api.get<ProfileBrief[]>("/api/admin/profiles").then(setProfiles),
      api.get<Certification[]>("/api/admin/certifications").then(setCerts).catch(() => {}),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const skillsByUser = new Map(profiles.map(p => [p.userId, p.skills ?? null]));
  const passedCertsByUser = new Map<number, Certification[]>();
  for (const c of certs) {
    if (c.status !== "passed") continue;
    const list = passedCertsByUser.get(c.userId) || [];
    list.push(c);
    passedCertsByUser.set(c.userId, list);
  }

  const filtered = users.filter(u =>
    !search || u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.department && u.department.includes(search))
  );

  // Group by department, 未分配 last
  const groups = depts.map(d => ({ dept: d.name, members: filtered.filter(u => u.departmentId === d.id) }))
    .filter(g => g.members.length > 0);
  const unassigned = filtered.filter(u => !u.departmentId || !depts.some(d => d.id === u.departmentId));

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">队员档案</h1>
        <p className="text-sm text-muted">按部门查看队员技能与认证 · 点击卡片进入详情</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索队员姓名或部门..."
          className="w-full rounded-xl border border-border bg-surface pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50/30" />
      </div>

      {/* Grouped list */}
      {[...groups, ...(unassigned.length > 0 ? [{ dept: "未分配", members: unassigned }] : [])].map(({ dept, members }) => (
        <div key={dept}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold">{dept}</span>
            <span className="text-xs text-faint">{members.length} 人</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map(u => {
              const skills = (skillsByUser.get(u.id) || "").split(",").map(s => s.trim()).filter(Boolean);
              const certs = passedCertsByUser.get(u.id) || [];
              return (
                <Link key={u.id} href={`/admin/profiles/${u.id}`}
                  className="rounded-xl border border-border bg-surface p-4 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {u.username[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{u.username}</div>
                      <div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE[u.role] || ROLE_BADGE.member}`}>
                          {u.role === "admin" ? "管理员" : u.role === "部长" ? "部长" : "成员"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {skills.slice(0, 4).map(s => (
                        <span key={s} className="px-2 py-0.5 rounded-full text-[11px] bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{s}</span>
                      ))}
                      {skills.length > 4 && <span className="text-[11px] text-faint self-center">+{skills.length - 4}</span>}
                    </div>
                  )}
                  {certs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {certs.slice(0, 2).map(c => (
                        <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          <BadgeCheck className="h-3 w-3" />{c.certName}{c.level && `·${c.level}`}
                        </span>
                      ))}
                      {certs.length > 2 && <span className="text-[11px] text-faint self-center">+{certs.length - 2}</span>}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-faint">
          <User className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
          <p>暂无队员</p>
        </div>
      )}
    </div>
  );
}

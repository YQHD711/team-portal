"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Search, Upload, User as UserIcon, BadgeCheck } from "lucide-react";
import { OrgUser, Certification, Dept } from "./types";

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  部长: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  member: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

interface Props {
  users: OrgUser[];
  depts: Dept[];
  isAdmin: boolean;
  skillsByUser: Map<number, string | null>;
  /** 档案页链接用公开 slug（不是自增 ID） */
  slugByUser: Map<number, string | null>;
  passedCertsByUser: Map<number, Certification[]>;
}

/**
 * 队员档案页签（原 /admin/profiles 独立页）。
 *
 * 与「组织架构」并到同一页：两者本来就是同一批人、同一批部门数据，拆成两个导航项
 * 只是让人多点一次。数据由外层页面统一加载后传进来，这里不再重复拉一遍。
 */
export default function ProfilesTab({ users, depts, isAdmin, skillsByUser, slugByUser, passedCertsByUser }: Props) {
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const importCompetitions = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { alert("请选择 CSV 文件"); return; }
    const token = localStorage.getItem("token");
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch("/api/admin/competitions/import", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) { setImportMsg({ ok: false, text: data.detail || "导入失败" }); return; }
      const skipTxt = data.skipped?.length ? `；跳过 ${data.skipped.length} 条（${data.skipped.slice(0, 3).map((s: { username: string; reason: string }) => `${s.username}:${s.reason}`).join("，")}${data.skipped.length > 3 ? "…" : ""}）` : "";
      setImportMsg({ ok: true, text: data.message + skipTxt });
    } catch { setImportMsg({ ok: false, text: "导入失败：请检查文件" }); }
  };

  const filtered = users.filter(u =>
    !search || u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.department && u.department.includes(search))
  );
  const groups = depts.map(d => ({ dept: d.name, members: filtered.filter(u => u.departmentId === d.id) }))
    .filter(g => g.members.length > 0);
  const unassigned = filtered.filter(u => !u.departmentId || !depts.some(d => d.id === u.departmentId));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索队员姓名或部门..." aria-label="搜索队员"
          className="w-full rounded-xl border border-border bg-surface pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      {/* 参赛记录 CSV 批量导入(仅管理员) */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium">导入参赛记录(CSV)：</label>
            <input ref={fileRef} type="file" accept=".csv" className="text-sm w-64 file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 file:bg-sky-50 file:text-sky-700" />
            <button onClick={importCompetitions} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
              <Upload className="h-4 w-4" />导入
            </button>
          </div>
          <p className="text-xs text-faint">CSV 列: 队员名,比赛名称,日期(yyyy-MM-dd),参赛项目,名次,证书链接,备注（队员不存在或日期无效会跳过）</p>
          {importMsg && <p className={`text-sm ${importMsg.ok ? "text-success" : "text-danger"}`}>{importMsg.text}</p>}
        </div>
      )}

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
                <Link key={u.id} href={`/admin/profiles/${slugByUser.get(u.id) ?? ""}`}
                  className="rounded-xl border border-border bg-surface p-4 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {u.username[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{u.username}</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
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
          <UserIcon className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
          <p>暂无队员</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, Building2, Users as UsersIcon, BadgeCheck, Tag, ClipboardCheck } from "lucide-react";
import { Dept, OrgUser, Certification, ExamBrief, ExamPass } from "./types";
import { DeptFormModal, UserFormModal } from "./OrgModals";

interface Props {
  users: OrgUser[];
  depts: Dept[];
  passedCertsByUser: Map<number, Certification[]>;
  examPassesByUser: Map<number, ExamPass[]>;
  skillsByUser: Map<number, string | null>;
  examsByDept: Map<number, ExamBrief[]>;
  onChanged: () => void;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  部长: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  member: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export function OrgTab({ users, depts, passedCertsByUser, examPassesByUser, skillsByUser, examsByDept, onChanged }: Props) {
  const [deptModal, setDeptModal] = useState<{ open: boolean; edit: Dept | null }>({ open: false, edit: null });
  const [userModal, setUserModal] = useState<{ open: boolean; edit: OrgUser | null }>({ open: false, edit: null });

  // Group users by department, 未分配 last
  const groups = depts.map(d => ({ dept: d, members: users.filter(u => u.departmentId === d.id) }));
  const unassigned = users.filter(u => !u.departmentId || !depts.some(d => d.id === u.departmentId));

  const deleteDept = async (d: Dept) => {
    if (!confirm(`确认删除部门 "${d.name}"？其队员将变为未分配`)) return;
    try { await api.delete(`/api/admin/departments/${d.id}`); onChanged(); } catch { alert("删除失败"); }
  };

  const deleteUser = async (u: OrgUser) => {
    if (!confirm(`确认删除队员 "${u.username}"？`)) return;
    try { await api.delete(`/api/admin/users/${u.id}`); onChanged(); } catch { alert("无法删除管理员账号"); }
  };

  return (
    <div className="space-y-8">
      {/* ── 部门区 ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">部门</h2>
          <button onClick={() => setDeptModal({ open: true, edit: null })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" />添加部门
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(({ dept, members }) => (
            <div key={dept.id} className="rounded-xl border border-border bg-surface p-4 group hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600"><Building2 className="h-5 w-5" /></div>
                  <div>
                    <div className="font-medium">{dept.name}</div>
                    <div className="text-xs text-muted mt-0.5 line-clamp-2">{dept.description || "暂无描述"}</div>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setDeptModal({ open: true, edit: dept })} className="p-1.5 rounded hover:bg-surface-hover text-faint hover:text-sky-600" title="编辑"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => deleteDept(dept)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger" title="删除"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><UsersIcon className="h-3.5 w-3.5" />{members.length} 人</span>
                <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" />{examsByDept.get(dept.id)?.length || 0} 场考核</span>
              </div>
            </div>
          ))}
          {depts.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3 text-center py-10 text-faint">
              <Building2 className="h-10 w-10 mx-auto mb-2 text-zinc-300" />暂无部门
            </div>
          )}
        </div>
      </section>

      {/* ── 队员区(按部门分组) ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">队员</h2>
          <button onClick={() => setUserModal({ open: true, edit: null })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" />添加队员
          </button>
        </div>

        {groups.map(({ dept, members }) => (
          <MemberGroup key={dept.id} title={dept.name} members={members}
            passedCertsByUser={passedCertsByUser} examPassesByUser={examPassesByUser} skillsByUser={skillsByUser}
            onEdit={u => setUserModal({ open: true, edit: u })} onDelete={deleteUser} />
        ))}
        {unassigned.length > 0 && (
          <MemberGroup title="未分配" members={unassigned}
            passedCertsByUser={passedCertsByUser} examPassesByUser={examPassesByUser} skillsByUser={skillsByUser}
            onEdit={u => setUserModal({ open: true, edit: u })} onDelete={deleteUser} />
        )}
        {users.length === 0 && (
          <div className="text-center py-10 text-faint"><UsersIcon className="h-10 w-10 mx-auto mb-2 text-zinc-300" />暂无队员</div>
        )}
      </section>

      {/* ── 弹窗 ── */}
      {deptModal.open && (
        <DeptFormModal dept={deptModal.edit} onClose={() => setDeptModal({ open: false, edit: null })}
          onSaved={() => { setDeptModal({ open: false, edit: null }); onChanged(); }} />
      )}
      {userModal.open && (
        <UserFormModal user={userModal.edit} depts={depts} onClose={() => setUserModal({ open: false, edit: null })}
          onSaved={() => { setUserModal({ open: false, edit: null }); onChanged(); }} />
      )}
    </div>
  );
}

// ── 部门分组内的队员卡片 ──
function MemberGroup({ title, members, passedCertsByUser, examPassesByUser, skillsByUser, onEdit, onDelete }: {
  title: string; members: OrgUser[];
  passedCertsByUser: Map<number, Certification[]>;
  examPassesByUser: Map<number, ExamPass[]>;
  skillsByUser: Map<number, string | null>;
  onEdit: (u: OrgUser) => void; onDelete: (u: OrgUser) => void;
}) {
  if (members.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-faint">{members.length} 人</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map(u => {
          const skills = (skillsByUser.get(u.id) || "").split(",").map(s => s.trim()).filter(Boolean);
          const certs = passedCertsByUser.get(u.id) || [];
          const examPasses = examPassesByUser.get(u.id) || [];
          return (
            <Link key={u.id} href={`/admin/profiles/${u.id}`}
              className="rounded-xl border border-border bg-surface p-4 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm transition-all group">
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
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.preventDefault(); onEdit(u); }} className="p-1.5 rounded hover:bg-surface-hover text-faint hover:text-sky-600" title="编辑"><Pencil className="h-4 w-4" /></button>
                  {u.role !== "admin" && u.role !== "部长" && (
                    <button onClick={e => { e.preventDefault(); onDelete(u); }} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger" title="删除"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
              {skills.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-faint mb-1"><Tag className="h-3 w-3" />技能</div>
                  <div className="flex flex-wrap gap-1">
                    {skills.slice(0, 3).map(s => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <Tag className="h-3 w-3 opacity-60" />{s}
                      </span>
                    ))}
                    {skills.length > 3 && <span className="text-[11px] text-faint self-center">+{skills.length - 3}</span>}
                  </div>
                </div>
              )}
              {(certs.length > 0 || examPasses.length > 0) && (
                <div className="mt-2">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-success/70 dark:text-green-400/70 mb-1"><BadgeCheck className="h-3 w-3" />团队认证</div>
                  <div className="flex flex-wrap gap-1">
                    {certs.slice(0, 2).map(c => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800">
                        <BadgeCheck className="h-3 w-3" />{c.certName}{c.level && `·${c.level}`}
                      </span>
                    ))}
                    {examPasses.slice(0, 2).map(p => (
                      <span key={p.id} title={`${p.examTitle}${p.score != null ? ` ${p.score}分` : ""}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
                        <ClipboardCheck className="h-3 w-3" />{p.examTitle}{p.score != null && `·${p.score}分`}
                      </span>
                    ))}
                    {(certs.length + examPasses.length) > 4 && (
                      <span className="text-[11px] text-faint self-center">+{certs.length + examPasses.length - 4}</span>
                    )}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

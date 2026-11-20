"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, Users as UsersIcon, Search, X } from "lucide-react";
import { Dept, OrgUser, Certification, ExamBrief, ExamPass } from "./types";
import { DeptFormModal, UserFormModal } from "./OrgModals";
import { MemberCard, displayNameOf } from "./MemberCard";

interface Props {
  users: OrgUser[];
  depts: Dept[];
  isAdmin: boolean;
  /** 部长视角限定本部门；admin 为 null（全量） */
  ownDeptId: number | null;
  passedCertsByUser: Map<number, Certification[]>;
  examPassesByUser: Map<number, ExamPass[]>;
  skillsByUser: Map<number, string | null>;
  /** 档案页链接用公开 slug（不是自增 ID）；缺失时卡片不可点 */
  slugByUser: Map<number, string | null>;
  examsByDept: Map<number, ExamBrief[]>;
  onChanged: () => void;
}

type DeptFilter = "all" | number;

/**
 * 组织架构主视图。
 *
 * 布局从「部门卡片网格 + 队员分组」两套重复结构，改成「搜索 + 部门筛选条 + 成员网格」：
 * 之前部门信息在一屏里出现两次、人员按部门分块但没法快速定位，人一多就很难用。
 * 现在顶部一条筛选条统一切换部门，右侧只渲染成员；部门本身的增删改收进选中部门的管理条。
 */
export function OrgTab({
  users, depts, isAdmin, ownDeptId,
  passedCertsByUser, examPassesByUser, skillsByUser, slugByUser, onChanged,
}: Props) {
  const [deptModal, setDeptModal] = useState<{ open: boolean; edit: Dept | null }>({ open: false, edit: null });
  const [userModal, setUserModal] = useState<{ open: boolean; edit: OrgUser | null }>({ open: false, edit: null });
  const [keyword, setKeyword] = useState("");
  const [deptFilter, setDeptFilter] = useState<DeptFilter>("all");

  // 部长只看自己部门；admin 看全部
  const viewDepts = isAdmin ? depts : depts.filter((d) => d.id === ownDeptId);
  const kw = keyword.trim().toLowerCase();

  const matches = (u: OrgUser) =>
    !kw ||
    displayNameOf(u).toLowerCase().includes(kw) ||
    u.username.toLowerCase().includes(kw) ||
    (u.studentId ?? "").toLowerCase().includes(kw);

  const filtered = users.filter(matches);
  const membersOf = (deptId: number) => filtered.filter((u) => u.departmentId === deptId);
  const unassigned = filtered.filter((u) => !u.departmentId || !depts.some((d) => d.id === u.departmentId));

  const visibleGroups = viewDepts
    .filter((d) => deptFilter === "all" || deptFilter === d.id)
    .map((d) => ({ dept: d, members: membersOf(d.id) }))
    .filter((g) => g.members.length > 0 || deptFilter !== "all");

  const shownCount =
    visibleGroups.reduce((n, g) => n + g.members.length, 0) +
    (deptFilter === "all" ? unassigned.length : 0);

  const activeDept = typeof deptFilter === "number" ? viewDepts.find((d) => d.id === deptFilter) : undefined;

  const deleteDept = async (d: Dept) => {
    if (!confirm(`确认删除部门 "${d.name}"？其队员将变为未分配`)) return;
    try {
      await api.delete(`/api/admin/departments/${d.id}`);
      setDeptFilter("all");
      onChanged();
    } catch {
      alert("删除失败");
    }
  };

  const deleteUser = async (u: OrgUser) => {
    if (!confirm(`确认删除队员 "${displayNameOf(u)}"？`)) return;
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      onChanged();
    } catch {
      alert("无法删除管理员账号");
    }
  };

  const renderGroup = (title: string, members: OrgUser[], key: string) => {
    if (members.length === 0) return null;
    return (
      <section key={key}>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-xs text-faint">{members.length} 人</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((u) => (
            <MemberCard
              key={u.id}
              user={u}
              slug={slugByUser.get(u.id) ?? null}
              skills={(skillsByUser.get(u.id) || "").split(",").map((s) => s.trim()).filter(Boolean)}
              certs={passedCertsByUser.get(u.id) ?? []}
              examPasses={examPassesByUser.get(u.id) ?? []}
              canEdit={isAdmin || u.role !== "admin"}
              canDelete={isAdmin && u.role !== "admin" && u.role !== "部长"}
              onEdit={() => setUserModal({ open: true, edit: u })}
              onDelete={() => deleteUser(u)}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      {/* 工具栏：搜索 + 新增 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索真名 / 用户名 / 学号"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-sm outline-none focus:border-sky-400"
            aria-label="搜索队员"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-foreground"
              title="清除搜索"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => setDeptModal({ open: true, edit: null })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-hover"
            >
              <Plus className="h-4 w-4" />添加部门
            </button>
            <button
              onClick={() => setUserModal({ open: true, edit: null })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" />添加队员
            </button>
          </div>
        )}
      </div>

      {/* 部门筛选条 */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          onClick={() => setDeptFilter("all")}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
            deptFilter === "all"
              ? "border-primary bg-primary text-white"
              : "border-border bg-surface text-muted hover:bg-surface-hover"
          }`}
        >
          全部 <span className="text-xs opacity-80">{users.length}</span>
        </button>
        {viewDepts.map((d) => {
          const count = users.filter((u) => u.departmentId === d.id).length;
          const active = deptFilter === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setDeptFilter(d.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-muted hover:bg-surface-hover"
              }`}
            >
              {d.name} <span className="text-xs opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 选中部门的管理条（仅 admin）：部门的编辑/删除收在这里，不再和成员卡片混排 */}
      {isAdmin && activeDept && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2">
          <div className="min-w-0">
            <span className="text-sm font-medium">{activeDept.name}</span>
            <span className="ml-2 text-xs text-faint">{activeDept.description || "暂无描述"}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => setDeptModal({ open: true, edit: activeDept })}
              className="rounded-md p-1.5 text-faint hover:bg-surface-hover hover:text-sky-600"
              title="编辑"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => deleteDept(activeDept)}
              className="rounded-md p-1.5 text-danger/70 hover:bg-red-50 hover:text-danger dark:hover:bg-red-950"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 成员网格 */}
      {shownCount === 0 ? (
        <div className="py-16 text-center text-faint">
          <UsersIcon className="mx-auto mb-2 h-10 w-10 text-zinc-300" />
          {kw ? `没有匹配「${keyword.trim()}」的队员` : "暂无队员"}
        </div>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map((g) => renderGroup(g.dept.name, g.members, `dept-${g.dept.id}`))}
          {deptFilter === "all" && renderGroup("未分配", unassigned, "unassigned")}
        </div>
      )}

      {/* 弹窗 */}
      {deptModal.open && isAdmin && (
        <DeptFormModal
          dept={deptModal.edit}
          onClose={() => setDeptModal({ open: false, edit: null })}
          onSaved={() => { setDeptModal({ open: false, edit: null }); onChanged(); }}
        />
      )}
      {userModal.open && (
        <UserFormModal
          user={userModal.edit}
          depts={depts}
          isAdmin={isAdmin}
          onClose={() => setUserModal({ open: false, edit: null })}
          onSaved={() => { setUserModal({ open: false, edit: null }); onChanged(); }}
        />
      )}
    </div>
  );
}

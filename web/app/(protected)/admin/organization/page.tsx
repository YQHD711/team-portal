"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Users, Building2, BadgeCheck, ClipboardCheck, Loader2 } from "lucide-react";
import { OrgTab } from "@/components/admin/organization/OrgTab";
import { InvitesTab } from "@/components/admin/organization/InvitesTab";
import { ImportTab } from "@/components/admin/organization/ImportTab";
import { Dept, OrgUser, ProfileBrief, Certification, ExamBrief, ExamPass } from "@/components/admin/organization/types";

export default function OrganizationPage() {
  const { user: me } = useCurrentUser();
  const isAdmin = me?.role === "admin";
  // 部长:只在本部门内自主;admin:全队
  const ownDeptId = isAdmin ? null : (me?.departmentId ?? null);

  const [tab, setTab] = useState<"org" | "invites" | "import">("org");
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [profiles, setProfiles] = useState<ProfileBrief[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [exams, setExams] = useState<ExamBrief[]>([]);
  const [examPasses, setExamPasses] = useState<ExamPass[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    return Promise.all([
      api.get<OrgUser[]>("/api/admin/users").then(setUsers),
      api.get<Dept[]>("/api/admin/departments").then(setDepts),
      api.get<ProfileBrief[]>("/api/admin/profiles").then(setProfiles),
      api.get<Certification[]>("/api/admin/certifications").then(setCerts).catch(() => {}),
      api.get<ExamBrief[]>("/api/admin/exams").then(setExams).catch(() => {}),
      api.get<ExamPass[]>("/api/admin/exams/passes").then(setExamPasses).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 部长仅可见本部门;admin 全量
  const visibleDepts = isAdmin ? depts : depts.filter(d => d.id === ownDeptId);

  const passedByUser = new Map<number, Certification[]>();
  for (const c of certs) {
    if (c.status !== "passed") continue;
    const list = passedByUser.get(c.userId) || [];
    list.push(c);
    passedByUser.set(c.userId, list);
  }
  const examPassesByUser = new Map<number, ExamPass[]>();
  for (const p of examPasses) {
    const list = examPassesByUser.get(p.userId) || [];
    list.push(p);
    examPassesByUser.set(p.userId, list);
  }
  const skillsByUser = new Map(profiles.map(p => [p.userId, p.skills ?? null]));
  const examsByDept = new Map<number, ExamBrief[]>();
  for (const e of exams) {
    const list = examsByDept.get(e.departmentId) || [];
    list.push(e);
    examsByDept.set(e.departmentId, list);
  }

  // 部长只统计本部门(users 后端已限定本部门+自己)
  const stats = isAdmin
    ? [
        { label: "总人数", value: users.length, icon: Users },
        { label: "部门数", value: depts.length, icon: Building2 },
        { label: "已认证人数", value: users.filter(u => passedByUser.has(u.id) || examPassesByUser.has(u.id)).length, icon: BadgeCheck },
        { label: "考核数", value: exams.length, icon: ClipboardCheck },
      ]
    : [
        { label: "本部门人数", value: users.length, icon: Users },
        { label: "已认证人数", value: users.filter(u => passedByUser.has(u.id) || examPassesByUser.has(u.id)).length, icon: BadgeCheck },
        { label: "本部门考核", value: ownDeptId != null ? (examsByDept.get(ownDeptId)?.length ?? 0) : 0, icon: ClipboardCheck },
      ];

  type OrgTabKey = "org" | "invites" | "import";
  const tabs: { key: OrgTabKey; label: string }[] = [{ key: "org", label: "组织架构" }];
  if (me?.role === "admin" || me?.role === "部长") tabs.push({ key: "invites", label: "邀请码" });
  if (isAdmin) tabs.push({ key: "import", label: "批量导入" });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">组织架构</h1>
          <p className="text-sm text-muted">{isAdmin ? "部门与队员统一管理 · 按部门展示队员技能与认证" : "本部门队员管理 · 技能与认证"}</p>
        </div>
      </div>

      {/* Stats */}
      <div className={`grid gap-3 ${stats.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-faint"><s.icon className="h-4 w-4" /><span className="text-xs">{s.label}</span></div>
            <div className="text-2xl font-bold mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>
      ) : tab === "org" ? (
        <OrgTab users={users} depts={depts} isAdmin={isAdmin} ownDeptId={ownDeptId}
          passedCertsByUser={passedByUser}
          examPassesByUser={examPassesByUser} skillsByUser={skillsByUser} examsByDept={examsByDept} onChanged={refresh} />
      ) : tab === "invites" ? (
        <InvitesTab depts={visibleDepts} onChanged={refresh} />
      ) : (
        <ImportTab onImported={refresh} />
      )}
    </div>
  );
}

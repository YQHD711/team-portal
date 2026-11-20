"use client";

import Link from "next/link";
import { Pencil, Trash2, BadgeCheck, ClipboardCheck, Tag } from "lucide-react";
import { type OrgUser, type Certification, type ExamPass } from "./types";

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  部长: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  member: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

/** 真名优先，没有填写时回落登录名。全站显示统一走这个函数，避免各处各自判空。 */
export function displayNameOf(u: OrgUser): string {
  return u.displayName?.trim() || u.username;
}

interface Props {
  user: OrgUser;
  /** 公开档案 slug；为 null 时卡片不可点击（避免跳到 /admin/profiles/ 这种 404 地址） */
  slug: string | null;
  skills: string[];
  certs: Certification[];
  examPasses: ExamPass[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function MemberCard({ user: u, slug, skills, certs, examPasses, canEdit, canDelete, onEdit, onDelete }: Props) {
  const name = displayNameOf(u);
  const hasExtras = skills.length > 0 || certs.length > 0 || examPasses.length > 0;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-white">
          {name[0]?.toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
            <span className={`rounded-full px-2 py-0.5 font-medium ${ROLE_BADGE[u.role] ?? ROLE_BADGE.member}`}>
              {u.role === "admin" ? "管理员" : u.role === "部长" ? "部长" : "成员"}
            </span>
            {u.displayName?.trim() && <span className="truncate">@{u.username}</span>}
            {u.studentId && <span>学号 {u.studentId}</span>}
            {u.identityDisabled && (
              <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-danger">已挂失</span>
            )}
          </div>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex shrink-0 gap-0.5">
            {canEdit && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                className="rounded-md p-1.5 text-faint hover:bg-surface-hover hover:text-sky-600"
                title="编辑"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
                className="rounded-md p-1.5 text-danger/70 hover:bg-red-50 hover:text-danger dark:hover:bg-red-950"
                title="删除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {hasExtras && (
        <div className="mt-3 space-y-1.5">
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skills.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <Tag className="h-3 w-3 opacity-60" />
                  {s}
                </span>
              ))}
              {skills.length > 3 && (
                <span className="self-center text-[11px] text-faint">+{skills.length - 3}</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {certs.slice(0, 2).map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300"
              >
                <BadgeCheck className="h-3 w-3" />
                {c.certName}{c.level && `·${c.level}`}
              </span>
            ))}
            {examPasses.slice(0, 2).map((p) => (
              <span
                key={p.id}
                title={`${p.examTitle}${p.score != null ? ` ${p.score}分` : ""}`}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                <ClipboardCheck className="h-3 w-3" />
                {p.examTitle}{p.score != null && `·${p.score}分`}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const base = "block rounded-xl border border-border bg-surface p-3.5 transition-all";
  if (!slug) return <div className={base}>{body}</div>;
  return (
    <Link
      href={`/admin/profiles/${slug}`}
      className={`${base} hover:border-sky-300 hover:shadow-sm dark:hover:border-sky-700`}
    >
      {body}
    </Link>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BatteryCharging, BookOpen, CheckCircle2, IdCard, Users, X } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks";

const STORAGE_KEY = "tp-onboarding-done";

/**
 * 初次使用引导（新队员第一次登录看到）：完善显示姓名 → 等待分配部门 → 电池借还流程 → 学习库。
 * 点「开始使用」后不再显示（localStorage 标记）。
 */
export function OnboardingCard() {
  const { user } = useCurrentUser();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* 忽略 */ }
    setVisible(false);
  };

  if (!visible || !user) return null;

  const steps = [
    {
      icon: IdCard,
      title: "① 完善你的显示姓名",
      desc: user.displayName?.trim()
        ? "当前显示名：" + user.displayName + "，可在「我的档案」修改"
        : "在「我的档案」填上真实姓名，队友和借还记录里才能认出你",
      href: "/profile",
      done: !!user.displayName?.trim(),
    },
    {
      icon: Users,
      title: "② 等待分配部门",
      desc: user.department
        ? "你已属于「" + user.department + "」"
        : "管理员分配部门后，才能看到部门知识库和考核安排",
      href: "/study",
      done: !!user.department,
    },
    {
      icon: BatteryCharging,
      title: "③ 借电池：到柜前扫码",
      desc: "扫柜前的电池二维码 → 点「借出」；用完扫一下点「归还」。在「电池借还」页能看到你在借的电池",
      href: "/batteries",
      done: false,
    },
    {
      icon: BookOpen,
      title: "④ 从学习库开始",
      desc: "新队员先看入门课程；考核安排由部长发布",
      href: "/study",
      done: false,
    },
  ];

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">欢迎加入！四步上手</h2>
          <p className="text-sm text-muted">点过「开始使用」后不再显示</p>
        </div>
        <button onClick={dismiss} className="p-1 rounded hover:bg-surface-hover text-muted" aria-label="关闭引导">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map(s => (
          <Link key={s.title} href={s.href} onClick={dismiss}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 hover:border-primary/40 transition-colors">
            <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {s.title}
                {s.done && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
      <button onClick={dismiss}
        className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">
        开始使用
      </button>
    </div>
  );
}

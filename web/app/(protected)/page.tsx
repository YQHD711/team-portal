"use client";

import { useState, useEffect } from "react";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { Bird, Users, Package, Database, TrendingUp, Sparkles, BookOpen } from "lucide-react";
import Link from "next/link";

interface Stats { userCount: number; inventoryCount: number; inventoryTotal: number; departmentCount: number; }

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => { api.get<Stats>("/api/admin/stats").then(setStats).catch(() => {}); }, []);

  const statCards = [
    { label: "团队成员", value: stats?.userCount ?? "—", icon: Users, color: "from-violet-500 to-purple-600", bg: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-400" },
    { label: "零件种类", value: stats?.inventoryCount ?? "—", icon: Package, color: "from-amber-500 to-orange-600", bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400" },
    { label: "零件总数", value: stats?.inventoryTotal ?? "—", icon: Database, color: "from-emerald-500 to-green-600", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    { label: "部门", value: stats?.departmentCount ?? "—", icon: Bird, color: "from-blue-500 to-cyan-500", bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400" },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6 sm:p-8 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
        <div className="relative flex items-center gap-4">
          <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur shadow-inner">
            <Bird className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">雏鹰之翼航模队</h1>
            <p className="text-blue-200/80 text-sm mt-1">高校航模队智能管理与运营平台</p>
          </div>
          <div className="ml-auto hidden md:flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 text-xs text-blue-200">
            <Sparkles className="h-3 w-3" /> AI 驱动
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {statCards.map(s => (
          <div key={s.label} className="card-hover rounded-2xl border border-border bg-surface p-4 flex items-center gap-3">
            <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${s.bg}`}>
              <s.icon className={`h-5 w-5 ${s.text}`} />
            </div>
            <div>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick links + Chat */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChatPanel />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">快捷入口</h3>
          {[
            { href: "/knowledge", label: "知识库", desc: "技术文档与手册", icon: BookOpen, color: "bg-blue-500/10 text-blue-600" },
            { href: "/inventory", label: "零件库存", desc: "库存管理与追踪", icon: Package, color: "bg-amber-500/10 text-amber-600" },
            { href: "/flightlog", label: "飞行日志", desc: "飞行数据分析", icon: TrendingUp, color: "bg-emerald-500/10 text-emerald-600" },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="card-hover flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted">{item.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

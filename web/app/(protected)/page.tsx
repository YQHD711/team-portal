"use client";

import { useState, useEffect } from "react";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { Bird, Users, BookOpen, Package, Database } from "lucide-react";

interface Stats { userCount: number; inventoryCount: number; inventoryTotal: number; departmentCount: number; }

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/admin/stats").then(setStats).catch(() => {});
  }, []);

  const statCards = [
    { label: "成员", value: stats?.userCount ?? "—", icon: Users, color: "text-purple-600 bg-purple-100 dark:bg-purple-950" },
    { label: "零件种类", value: stats?.inventoryCount ?? "—", icon: Package, color: "text-amber-600 bg-amber-100 dark:bg-amber-950" },
    { label: "零件总数", value: stats?.inventoryTotal ?? "—", icon: Database, color: "text-green-600 bg-green-100 dark:bg-green-950" },
    { label: "部门", value: stats?.departmentCount ?? "—", icon: Bird, color: "text-sky-600 bg-sky-100 dark:bg-sky-950" },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/25">
          <Bird className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">雏鹰之翼航模队</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">高校航模队管理与运营系统</p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {statCards.map(s => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 hover:shadow-md transition-shadow">
            <div className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg ${s.color}`}>
              <s.icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-zinc-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <ChatPanel />
    </div>
  );
}

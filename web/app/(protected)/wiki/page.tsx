"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { BookOpen, ExternalLink, GitBranch, Package, Trash2 } from "lucide-react";

interface TaskInfo {
  id: string; type: string; projectName: string; status: string; visibility: string; createdAt: string;
}

const visLabel = (v: string) => v === "department" ? "🏢 部门" : v === "personal" ? "🔒 个人" : "";

export default function WikiBrowsePage() {
  const [projects, setProjects] = useState<TaskInfo[]>([]);
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => { api.get<{role:string}>("/api/auth/me").then(u => setIsStaff(u.role === "admin" || u.role === "部长")).catch(()=>{}); }, []);

  const fetchProjects = () => api.get<TaskInfo[]>("/api/wiki/tasks").then(t => setProjects(t.filter(p => p.status === "completed"))).catch(() => {});
  useEffect(() => { fetchProjects(); }, []);
  const deleteProject = async (id: string, e: React.MouseEvent) => { e.preventDefault(); if (confirm("确定删除？")) { await api.delete(`/api/wiki/tasks/${id}`); fetchProjects(); } };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wiki 文档</h1>
        <p className="text-sm text-zinc-500 mt-1">查看 AI 生成的代码项目文档</p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <BookOpen className="h-12 w-12 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
          <p className="text-zinc-500">暂无已完成的项目文档</p>
          <p className="text-sm text-zinc-400 mt-1">管理员和部长可以提交代码仓库来生成文档</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map(p => (
            <Link key={p.id} href={`/wiki/${p.id}`}
              className="group relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md hover:border-sky-300 dark:hover:border-sky-700 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600">
                    {p.type === "git" ? <GitBranch className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                  </div>
                  <div>
                    <h3 className="font-semibold group-hover:text-sky-600 transition-colors">{p.projectName} <span className="text-xs font-normal text-zinc-400">{visLabel(p.visibility)}</span></h3>
                    <p className="text-xs text-zinc-400 mt-0.5">{p.type === "git" ? "GitHub 仓库" : "ZIP 上传"} · {new Date(p.createdAt).toLocaleDateString("zh-CN")}</p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-zinc-300 group-hover:text-sky-500 transition-colors shrink-0" />
              </div>
              {isStaff && (
                <button onClick={(e) => deleteProject(p.id, e)} className="absolute top-3 right-3 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-500 transition-all" title="删除"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

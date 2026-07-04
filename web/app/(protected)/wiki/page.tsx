"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { GitBranch, Upload, Loader2, CheckCircle, XCircle, Clock, RefreshCw, FileText } from "lucide-react";

interface TaskInfo {
  id: string; type: string; projectName: string; status: string;
  errorMessage: string | null; createdAt: string; completedAt: string | null;
}

export default function WikiPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [tab, setTab] = useState<"git" | "zip">("git");
  const [gitUrl, setGitUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchTasks = () => api.get<TaskInfo[]>("/api/wiki/tasks").then(setTasks).catch(() => {});

  useEffect(() => {
    fetchTasks();
    api.get<{ role: string }>("/api/admin/me").then(u => setRole(u.role)).catch(() => {});
    const t = setInterval(fetchTasks, 5000);
    return () => clearInterval(t);
  }, []);

  const canSubmit = role === "admin" || role === "部长";

  const submitGit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl || !projectName) return;
    setSubmitting(true); setMessage("");
    try {
      await api.post("/api/wiki/submit-git", { url: gitUrl, projectName, targetFolder: targetFolder || undefined });
      setMessage("✅ 已提交，后台正在处理...");
      setGitUrl(""); setProjectName(""); fetchTasks();
    } catch (err) { setMessage("❌ " + (err instanceof Error ? err.message : "提交失败")); }
    finally { setSubmitting(false); }
  };

  const submitZip = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !projectName) return;
    setSubmitting(true); setMessage("");
    try {
      const token = localStorage.getItem("token");
      const formData = new FormData();
      formData.append("file", file);
      const params = new URLSearchParams();
      params.set("projectName", projectName);
      if (targetFolder) params.set("targetFolder", targetFolder);

      const res = await fetch(`/api/wiki/submit-zip?${params}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ detail: "Failed" }))).detail);
      setMessage("✅ ZIP 已提交，后台正在处理...");
      setProjectName(""); if (fileRef.current) fileRef.current.value = "";
      fetchTasks();
    } catch (err) { setMessage("❌ " + (err instanceof Error ? err.message : "提交失败")); }
    finally { setSubmitting(false); }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
      case "pending": return <Clock className="h-4 w-4 text-amber-500" />;
      default: return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />;
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "completed": return "已完成"; case "failed": return "失败";
      case "pending": return "排队中"; case "preparing": return "准备中";
      case "catalog": return "生成目录"; case "documents": return "生成文档";
      default: return s;
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wiki 导入</h1>
        <p className="text-sm text-zinc-500 mt-1">导入 GitHub 仓库或代码压缩包，AI 自动生成 Wiki 文档</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1 w-fit">
        {[{ key: "git", label: "GitHub 仓库", icon: GitBranch }, { key: "zip", label: "ZIP 上传", icon: Upload }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as "git" | "zip")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Form — only admin/部长 */}
      {canSubmit ? (
      <form onSubmit={tab === "git" ? submitGit : submitZip} className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div>
          <label className="block text-sm font-medium mb-1">项目名称 *</label>
          <input value={projectName} onChange={e => setProjectName(e.target.value)}
            placeholder="例如: my-awesome-project" required
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>

        {tab === "git" ? (
          <div>
            <label className="block text-sm font-medium mb-1">GitHub URL *</label>
            <input value={gitUrl} onChange={e => setGitUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git" required
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">代码压缩包 * (.zip, 最大100MB)</label>
            <input ref={fileRef} type="file" accept=".zip" required
              className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 dark:file:bg-sky-950 dark:file:text-sky-300" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">目标文件夹（可选，默认公共知识库或您的部门）</label>
          <input value={targetFolder} onChange={e => setTargetFolder(e.target.value)}
            placeholder="公共" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>

        <button type="submit" disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors shadow-sm">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "git" ? <GitBranch className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {submitting ? "提交中..." : "提交任务"}
        </button>

        {message && <div className={`text-sm p-2.5 rounded-lg ${message.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-red-600"}`}>{message}</div>}
      </form>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center text-zinc-500">
          仅管理员和部长可以提交 Wiki 导入任务<br />
          生成的文档可在<a href="/knowledge" className="text-sky-500 hover:underline">知识库</a>中查看
        </div>
      )}

      {/* Task list */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-bold">处理队列</h2>
          <button onClick={fetchTasks} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><RefreshCw className="h-4 w-4 text-zinc-400" /></button>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-zinc-400"><FileText className="h-8 w-8 mx-auto mb-2 text-zinc-300" />暂无任务</div>
          ) : tasks.map(t => (
            <div key={t.id} className="p-4 flex items-center gap-3">
              {statusIcon(t.status)}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{t.projectName}</div>
                <div className="text-xs text-zinc-500">{t.type === "git" ? "GitHub" : "ZIP"} · {statusLabel(t.status)}</div>
                {t.errorMessage && <div className="text-xs text-red-500 mt-1">{t.errorMessage}</div>}
              </div>
              <div className="text-xs text-zinc-400">{new Date(t.createdAt).toLocaleString("zh-CN")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

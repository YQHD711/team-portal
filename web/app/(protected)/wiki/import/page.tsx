"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { GitBranch, Upload, Loader2, CheckCircle, XCircle, Clock, RefreshCw, Globe, Building2, Lock, Languages, Trash2 } from "lucide-react";

interface TaskInfo {
  id: string; type: string; projectName: string; status: string; visibility: string;
  errorMessage: string | null; createdAt: string; completedAt: string | null;
}

const visOptions = [
  { value: "public", label: "公共", icon: Globe, desc: "全员可见" },
  { value: "department", label: "部门", icon: Building2, desc: "仅本部门可见" },
  { value: "personal", label: "个人", icon: Lock, desc: "仅自己可见" },
];

export default function WikiImportPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [tab, setTab] = useState<"git" | "zip" | "translate">("git");
  const [gitUrl, setGitUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isStaff, setIsStaff] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.get<{role:string}>("/api/auth/me").then(u => setIsStaff(u.role === "admin" || u.role === "部长")).catch(()=>{}); }, []);

  const fetchTasks = () => api.get<TaskInfo[]>("/api/wiki/tasks").then(setTasks).catch(() => {});
  const deleteTask = async (id: string) => { if (confirm("确定删除？")) { await api.delete(`/api/wiki/tasks/${id}`); fetchTasks(); } };

  const submitGit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl || !projectName) return;
    setSubmitting(true); setMessage("");
    try {
      await api.post("/api/wiki/submit-git", { url: gitUrl, projectName, targetFolder: targetFolder || undefined, visibility });
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
      params.set("visibility", visibility);
      const res = await fetch(`/api/wiki/submit-zip?${params}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ detail: "Failed" }))).detail);
      setMessage("✅ ZIP 已提交，后台正在处理...");
      setProjectName(""); if (fileRef.current) fileRef.current.value = ""; fetchTasks();
    } catch (err) { setMessage("❌ " + (err instanceof Error ? err.message : "提交失败")); }
    finally { setSubmitting(false); }
  };

  const submitTranslate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl || !projectName) return;
    setSubmitting(true); setMessage("");
    try {
      await api.post("/api/wiki/submit-translate", { url: gitUrl, projectName, targetFolder: targetFolder || "公共", visibility });
      setMessage("✅ 翻译任务已提交，后台正在处理...");
      setGitUrl(""); setProjectName(""); fetchTasks();
    } catch (err) { setMessage("❌ " + (err instanceof Error ? err.message : "提交失败")); }
    finally { setSubmitting(false); }
  };

  const statusIcon = (s: string) => {
    switch (s) { case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />; case "failed": return <XCircle className="h-4 w-4 text-red-500" />; case "pending": return <Clock className="h-4 w-4 text-amber-500" />; default: return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />; }
  };
  const statusLabel = (s: string) => {
    switch (s) { case "completed": return "已完成"; case "failed": return "失败"; case "pending": return "排队中"; case "preparing": return "准备中"; case "cloning": return "克隆仓库"; case "translating": return "翻译中"; case "catalog": return "生成目录"; case "documents": return "生成文档"; default: return s; }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wiki 导入</h1>
        <p className="text-sm text-zinc-500 mt-1">提交 GitHub 仓库或 ZIP 压缩包，AI 自动生成技术文档</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1 w-fit flex-wrap">
        {[{ key: "git", label: "GitHub 仓库", icon: GitBranch }, { key: "zip", label: "ZIP 上传", icon: Upload }, { key: "translate", label: "翻译文档", icon: Languages }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as "git" | "zip" | "translate")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      <form key={tab} onSubmit={tab === "translate" ? submitTranslate : tab === "git" ? submitGit : submitZip} className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        {tab === "translate" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-sm">
            <Languages className="h-4 w-4 shrink-0" />
            克隆文档仓库后自动逐页翻译为中文。建议先翻译较小仓库测试效果。
          </div>
        )}
        <div><label className="block text-sm font-medium mb-1">项目名称 *</label><input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="例如: my-awesome-project" required className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
        {tab === "git" || tab === "translate" ? (
          <div><label className="block text-sm font-medium mb-1">Git URL *</label><input value={gitUrl ?? ""} onChange={e => setGitUrl(e.target.value)} placeholder={tab === "translate" ? "https://github.com/ArduPilot/ardupilot_wiki.git" : "https://github.com/user/repo.git"} required className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" /></div>
        ) : (
          <div><label className="block text-sm font-medium mb-1">代码压缩包 * (.zip, 最大100MB)</label><input ref={fileRef} type="file" accept=".zip" required className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 dark:file:bg-sky-950 dark:file:text-sky-300" /></div>
        )}
        <div><label className="block text-sm font-medium mb-1">目标文件夹（可选）</label><input value={targetFolder} onChange={e => setTargetFolder(e.target.value)} placeholder="公共" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
        <div><label className="block text-sm font-medium mb-1">可见范围</label>
          <div className="flex gap-2">
            {visOptions.map(o => (
              <button key={o.value} type="button" onClick={() => setVisibility(o.value)}
                className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm transition-all ${visibility === o.value ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"}`}>
                <o.icon className="h-5 w-5" />
                <span className="font-medium">{o.label}</span>
                <span className="text-xs text-zinc-400">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors shadow-sm">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "translate" ? <Languages className="h-4 w-4" /> : tab === "git" ? <GitBranch className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {submitting ? "提交中..." : tab === "translate" ? "开始翻译" : "提交任务"}
        </button>
        {message && <div className={`text-sm p-2.5 rounded-lg ${message.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-red-600"}`}>{message}</div>}
      </form>

      <div>
        <div className="flex items-center gap-2 mb-3"><h2 className="font-bold">任务队列</h2><button onClick={fetchTasks} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><RefreshCw className="h-4 w-4 text-zinc-400" /></button></div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {tasks.length === 0 ? <div className="p-8 text-center text-zinc-400">暂无任务</div> : tasks.map(t => (
            <div key={t.id} className="p-3 flex items-center gap-3">
              {statusIcon(t.status)}
              <div className="flex-1"><div className="font-medium text-sm">{t.projectName} <span className="text-xs text-zinc-400 ml-1">({t.visibility === "department" ? "部门" : t.visibility === "personal" ? "个人" : "公共"})</span></div><div className="text-xs text-zinc-500">{statusLabel(t.status)}</div>{t.errorMessage && <div className="text-xs text-red-500 mt-1">{t.errorMessage}</div>}</div>
              <div className="text-xs text-zinc-400">{new Date(t.createdAt).toLocaleString("zh-CN")}</div>
              {isStaff && <button onClick={() => deleteTask(t.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-500" title="删除任务"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

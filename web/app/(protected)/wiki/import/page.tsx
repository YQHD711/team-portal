"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { GitBranch, Upload, Loader2, Languages, Globe, Building2, Lock } from "lucide-react";
import { ModelInput } from "@/components/ui/ModelInput";
import { retryMissingDocuments } from "@/lib/wikiRetry";
import { TaskQueue, isActiveTask, type WikiTaskInfo } from "@/components/wiki/TaskQueue";

const ACTIVE_POLL_MS = 5000; // 有进行中的任务时自动刷新；全部结束后停表

const visOptions = [
  { value: "public", label: "公共", icon: Globe, desc: "全员可见" },
  { value: "department", label: "部门", icon: Building2, desc: "仅本部门可见" },
  { value: "personal", label: "个人", icon: Lock, desc: "仅自己可见" },
];

export default function WikiImportPage() {
  const [tasks, setTasks] = useState<WikiTaskInfo[]>([]);
  const [tab, setTab] = useState<"git" | "zip" | "translate">("git");
  const [gitUrl, setGitUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("");
  const [customCatalogJson, setCustomCatalogJson] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";
  const fileRef = useRef<HTMLInputElement>(null);
  const initedRef = useRef(false);

  const fetchTasks = () => api.get<WikiTaskInfo[]>("/api/wiki/tasks").then(setTasks).catch(() => {});
  const deleteTask = async (id: string) => { if (confirm("确定删除？")) { await api.delete(`/api/wiki/tasks/${id}`); fetchTasks(); } };
  // 补齐缺失文档：先预览要补几篇再确认（不重跑已有文档/目录/源码，费用只与缺失篇数相关）
  const regenerateTask = async (id: string) => {
    const name = tasks.find(t => t.id === id)?.projectName ?? "该项目";
    try {
      const msg = await retryMissingDocuments(id, name);
      if (msg) alert(msg);
      fetchTasks();
    } catch (err) {
      alert("补齐失败：" + (err instanceof Error ? err.message : "未知错误"));
    }
  };
  const fetchModels = () => {
    api.get<{ availableModels?: string[]; contentModel?: string }>("/api/wiki/settings")
      .then(s => {
        if (s.availableModels?.length) {
          setAvailableModels(s.availableModels);
          if (!initedRef.current && s.contentModel) { setModel(s.contentModel); initedRef.current = true; }
        }
      }).catch(() => {});
  };
  // 首屏必须拉一次任务列表（此前只在提交/手动刷新时拉，打开页面永远显示"暂无任务"）
  useEffect(() => { fetchTasks(); fetchModels(); }, []);

  // 进行中的任务自动刷新（此前必须手点刷新按钮，进度看起来是"卡住"的）
  useEffect(() => {
    if (!tasks.some(t => isActiveTask(t.status))) return;
    const timer = setInterval(fetchTasks, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [tasks]);

  const submitGit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl || !projectName) return;
    setSubmitting(true); setMessage("");
    try {
      await api.post("/api/wiki/submit-git", { url: gitUrl, projectName, targetFolder: targetFolder || undefined, visibility, model: model || undefined, customCatalogJson: customCatalogJson || undefined });
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
      if (model) params.set("model", model);
      if (customCatalogJson) params.set("customCatalogJson", customCatalogJson);
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
      await api.post("/api/wiki/submit-translate", { url: gitUrl, projectName, targetFolder: targetFolder || "公共", visibility, model: model || undefined, customCatalogJson: customCatalogJson || undefined });
      setMessage("✅ 翻译任务已提交，后台正在处理...");
      setGitUrl(""); setProjectName(""); fetchTasks();
    } catch (err) { setMessage("❌ " + (err instanceof Error ? err.message : "提交失败")); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wiki 导入</h1>
        <p className="text-sm text-muted mt-1">提交 GitHub 仓库或 ZIP 压缩包，AI 自动生成技术文档</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1 w-fit flex-wrap">
        {[{ key: "git", label: "GitHub 仓库", icon: GitBranch }, { key: "zip", label: "ZIP 上传", icon: Upload }, { key: "translate", label: "翻译文档", icon: Languages }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as "git" | "zip" | "translate")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      <form key={tab} onSubmit={tab === "translate" ? submitTranslate : tab === "git" ? submitGit : submitZip} className="space-y-3 rounded-xl border border-border bg-surface p-5">
        {tab === "translate" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-sm">
            <Languages className="h-4 w-4 shrink-0" />
            克隆文档仓库后自动逐页翻译为中文。建议先翻译较小仓库测试效果。
          </div>
        )}
        <div><label className="block text-sm font-medium mb-1">项目名称 *</label><input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="例如: my-awesome-project" required className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
        {tab === "git" || tab === "translate" ? (
          <div><label className="block text-sm font-medium mb-1">Git URL *</label><input value={gitUrl ?? ""} onChange={e => setGitUrl(e.target.value)} placeholder={tab === "translate" ? "https://github.com/ArduPilot/ardupilot_wiki.git" : "https://github.com/user/repo.git"} required className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono" /></div>
        ) : (
          <div><label className="block text-sm font-medium mb-1">代码压缩包 * (.zip, 最大100MB)</label><input ref={fileRef} type="file" accept=".zip" required className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 dark:file:bg-sky-950 dark:file:text-sky-300" /></div>
        )}
        <div><label className="block text-sm font-medium mb-1">目标文件夹（可选）</label><input value={targetFolder} onChange={e => setTargetFolder(e.target.value)} placeholder="公共" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
        <div><label className="block text-sm font-medium mb-1">可见范围</label>
          <div className="flex gap-2">
            {visOptions.map(o => (
              <button key={o.value} type="button" onClick={() => setVisibility(o.value)}
                className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm transition-all ${visibility === o.value ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-border dark:border-zinc-700 hover:border-zinc-400"}`}>
                <o.icon className="h-5 w-5" />
                <span className="font-medium">{o.label}</span>
                <span className="text-xs text-faint">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">生成模型（可选，留空则用全局默认；可填任意模型名）</label>
          <ModelInput
            value={model}
            onChange={setModel}
            suggestions={availableModels.length ? availableModels : undefined}
            label="生成模型"
            placeholder="留空使用全局默认，或填入模型名"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            自定义目录结构（可选 JSON，留空则 AI 自动生成）
            <a className="ml-2 text-xs text-faint hover:text-sky-500 cursor-pointer" onClick={() => setCustomCatalogJson(JSON.stringify([
              { path: "getting-started", title: "快速开始", children: [{ path: "getting-started/installation", title: "安装指南" }] },
              { path: "core-modules", title: "核心模块" }
            ], null, 2))}>插入示例</a>
          </label>
          <textarea value={customCatalogJson} onChange={e => setCustomCatalogJson(e.target.value)} rows={6} placeholder='例如: [{"path":"getting-started","title":"快速开始"}]'
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-sm">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "translate" ? <Languages className="h-4 w-4" /> : tab === "git" ? <GitBranch className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {submitting ? "提交中..." : tab === "translate" ? "开始翻译" : "提交任务"}
        </button>
        {message && <div className={`text-sm p-2.5 rounded-lg ${message.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-danger"}`}>{message}</div>}
      </form>

      <TaskQueue tasks={tasks} isStaff={isStaff} onRefresh={fetchTasks} onDelete={deleteTask} onRegenerate={regenerateTask} />
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { StudyPath } from "@/components/study/StudyPath";
import { StudyLessonView } from "@/components/study/StudyLessonView";
import { StudyStatsPanel } from "@/components/study/StudyStatsPanel";
import { applyCompletion, flattenLessons, percent, type StudyScope } from "@/lib/studyNav";
import { GraduationCap, Loader2, Pencil, BookOpen, ChevronRight, Users } from "lucide-react";

/** 学习库：学习路径总览 ⇄ 课时阅读。结构与阶段说明来自 /api/study/library，正文走知识库接口。 */
export default function StudyPage() {
  const [scopes, setScopes] = useState<StudyScope[]>([]);
  const [scopeIdx, setScopeIdx] = useState(0);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";

  useEffect(() => {
    api.get<{ scopes: StudyScope[] }>("/api/study/library")
      .then(r => setScopes(r.scopes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 课时正文（正文接口与知识库同一个，权限同一套）
  useEffect(() => {
    if (!activePath) { setContent(""); return; }
    let cancelled = false;
    setDocLoading(true);
    api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(activePath)}`)
      .then(r => { if (!cancelled) setContent(r.content ?? ""); })
      .catch(() => { if (!cancelled) setContent("> 读取失败：可能没有权限，或文件已被删除。"); })
      .finally(() => { if (!cancelled) setDocLoading(false); });
    return () => { cancelled = true; };
  }, [activePath]);

  const scope = scopes[scopeIdx];
  const lessons = scope ? flattenLessons(scope.stages) : [];
  const idx = activePath ? lessons.findIndex(l => l.path === activePath) : -1;
  const activeLesson = idx >= 0 ? lessons[idx] : null;
  const stageTitle = scope?.stages.find(s => s.lessons.some(l => l.path === activePath))?.title ?? "";

  const pickScope = (i: number) => { setScopeIdx(i); setActivePath(null); setShowStats(false); };

  /** 勾选完成：先写服务端，再就地更新本地结构（后端是权威）。 */
  const toggle = async (path: string, completed: boolean) => {
    try {
      await api.post("/api/study/progress", { path, completed });
      setScopes(prev => prev.map(s => (s.scope === scope.scope ? applyCompletion(s, path, completed) : s)));
    } catch { /* 失败就保持原样，下次刷新以服务端为准 */ }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;
  if (scopes.length === 0) return <EmptyState />;

  const total = scope.lessonCount ?? lessons.length;
  const done = scope.completedCount ?? 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-sky-500" />学习库
          </h1>
          <p className="text-sm text-muted mt-1">
            按阶段组织的队内学习资料 · 内容与知识库同源，可搜索、可备份
            {total > 0 && <span className="ml-2 text-sky-600 dark:text-sky-400">已学 {done}/{total}（{percent(done, total)}%）</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStaff && (
            <button onClick={() => setShowStats(v => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${showStats ? "border-sky-400 text-sky-500" : "text-muted hover:text-sky-500 hover:border-sky-400"}`}>
              <Users className="h-3.5 w-3.5" />完成情况
            </button>
          )}
          {scope?.canEdit && (
            <Link href={`/admin/knowledge?path=${encodeURIComponent(scope.libraryPath)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted hover:text-sky-500 hover:border-sky-400">
              <Pencil className="h-3.5 w-3.5" />编辑本库
            </Link>
          )}
        </div>
      </header>

      {scopes.length > 1 && (
        <div className="flex gap-1 rounded-xl bg-surface-subtle p-1 w-fit flex-wrap">
          {scopes.map((s, i) => (
            <button key={s.scope} onClick={() => pickScope(i)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${i === scopeIdx ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {showStats && <StudyStatsPanel scope={scope.scope} onClose={() => setShowStats(false)} />}

      {activeLesson ? (
        <div className="grid gap-6 xl:grid-cols-[200px_1fr]">
          {/* 左：目录（大屏才显示；小屏靠面包屑与上一课/下一课） */}
          <nav className="hidden xl:block text-sm">
            <div className="sticky top-6 space-y-3 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <button onClick={() => setActivePath(null)} className="text-xs text-faint hover:text-sky-500">← 返回学习路径</button>
              {scope.stages.map(stage => (
                <div key={stage.path}>
                  <div className="text-xs font-medium text-muted mb-1">{stage.title}</div>
                  <ul className="space-y-0.5">
                    {stage.lessons.map(l => (
                      <li key={l.path}>
                        <button onClick={() => setActivePath(l.path)}
                          className={`w-full text-left rounded px-2 py-1 text-xs truncate transition-colors ${l.path === activePath ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium" : "text-faint hover:bg-surface-hover"}`}>
                          {l.completed ? "✓ " : ""}{l.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <StudyLessonView
            scope={scope} stageTitle={stageTitle} lesson={activeLesson} content={content} loading={docLoading}
            prev={idx > 0 ? lessons[idx - 1] : null}
            next={idx < lessons.length - 1 ? lessons[idx + 1] : null}
            total={lessons.length}
            onOpen={setActivePath} onBackToPath={() => setActivePath(null)}
            onToggle={completed => toggle(activeLesson.path, completed)} />
        </div>
      ) : (
        <StudyPath scope={scope} onOpenLesson={setActivePath} onToggle={toggle} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <GraduationCap className="h-6 w-6 text-sky-500" />学习库
      </h1>
      <div className="rounded-xl border bg-surface p-8 space-y-3">
        <div className="flex items-center gap-2 font-medium"><BookOpen className="h-4 w-4 text-faint" />还没有学习库内容</div>
        <p className="text-sm text-muted">
          学习库直接复用知识库的 Markdown，不需要另外维护一份。在知识库下建一个名为
          <code className="mx-1 rounded bg-surface-subtle px-1.5 py-0.5 text-xs">学习库</code>
          的目录即可，内容按「阶段 → 课时」两级组织。
        </p>
        <pre className="rounded-lg bg-surface-subtle p-3 text-xs overflow-x-auto">{`公共/学习库/
├── _学习路径.md          ← 总览（可选，卡片顶部展示）
├── 01-入门筑基/
│   ├── _阶段说明.md      ← 阶段目标/时长/自检清单（可选）
│   ├── 01-认识航模.md
│   └── 02-安全规范.md
└── 02-进阶实战/`}</pre>
        <p className="text-xs text-faint">
          一级子目录 = 阶段（用 01、02 两位数字前缀定序）；下划线开头的文件是说明，不当时课。
          阶段卡片上的「时长 / 目标」写在 <code className="rounded bg-surface-subtle px-1 py-0.5">_阶段说明.md</code> 开头，
          形如 <code className="mx-1 rounded bg-surface-subtle px-1.5 py-0.5">--- 时长: 2-3 周 ---</code>，不写也照样显示正文。
        </p>
        <Link href="/admin/knowledge" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          <Pencil className="h-4 w-4" />去知识库创建<ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

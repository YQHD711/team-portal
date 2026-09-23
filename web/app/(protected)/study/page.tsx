"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { GraduationCap, Loader2, Pencil, BookOpen, ChevronRight } from "lucide-react";

interface StudyLesson { title: string; path: string; canEdit: boolean; }
interface StudyStage { title: string; path: string; canEdit: boolean; descriptionPath: string | null; lessons: StudyLesson[]; }
interface StudyScope { scope: string; label: string; libraryPath: string; canEdit: boolean; overviewPath: string | null; stages: StudyStage[]; }

/** 学习库：只读浏览。结构来自 /api/study/library，正文走知识库接口（同一套 ACL）。 */
export default function StudyPage() {
  const [scopes, setScopes] = useState<StudyScope[]>([]);
  const [scopeIdx, setScopeIdx] = useState(0);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    api.get<{ scopes: StudyScope[] }>("/api/study/library")
      .then(r => setScopes(r.scopes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const scope = scopes[scopeIdx];

  // 选中的课时；未选时回落到该作用域的「_学习路径」总览
  useEffect(() => {
    const path = activePath ?? scope?.overviewPath ?? null;
    if (!path) { setContent(""); return; }
    let cancelled = false;
    setDocLoading(true);
    api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(path)}`)
      .then(r => { if (!cancelled) setContent(r.content ?? ""); })
      .catch(() => { if (!cancelled) setContent("> 读取失败：可能没有权限，或文件已被删除。"); })
      .finally(() => { if (!cancelled) setDocLoading(false); });
    return () => { cancelled = true; };
  }, [activePath, scope]);

  const pickScope = (i: number) => { setScopeIdx(i); setActivePath(null); };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  if (scopes.length === 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Header />
        <div className="rounded-xl border bg-surface p-8 space-y-3">
          <div className="flex items-center gap-2 font-medium"><BookOpen className="h-4 w-4 text-faint" />还没有学习库内容</div>
          <p className="text-sm text-muted">
            学习库直接复用知识库的 Markdown，不需要另外维护一份。在知识库下建一个名为
            <code className="mx-1 rounded bg-surface-subtle px-1.5 py-0.5 text-xs">学习库</code>
            的目录即可，内容按「阶段 → 课时」两级组织。
          </p>
          <pre className="rounded-lg bg-surface-subtle p-3 text-xs overflow-x-auto">{`公共/学习库/
├── _学习路径.md          ← 总览（可选，默认展示）
├── 01-入门筑基/
│   ├── _阶段说明.md      ← 阶段目标/时间预估/自检清单（可选）
│   ├── 01-认识航模.md
│   └── 02-安全规范.md
└── 02-进阶实战/`}</pre>
          <p className="text-xs text-faint">
            一级子目录 = 阶段（用 01、02 两位数字前缀定序，超过 9 个也不会乱序）；下划线开头的文件当作说明，不当时课。
            部门学习库放在 <code className="rounded bg-surface-subtle px-1 py-0.5">部门名/学习库/</code>，只有该部门和管理员看得到。
          </p>
          <Link href="/admin/knowledge" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Pencil className="h-4 w-4" />去知识库创建
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <Header />

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

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* 左：阶段 → 课时 */}
        <aside className="space-y-3">
          {scope && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{scope.label}</span>
                {scope.canEdit && (
                  <Link href={`/admin/knowledge?path=${encodeURIComponent(scope.libraryPath)}`}
                    className="inline-flex items-center gap-1 text-xs text-faint hover:text-sky-500">
                    <Pencil className="h-3 w-3" />编辑
                  </Link>
                )}
              </div>
              {scope.overviewPath && (
                <button onClick={() => setActivePath(null)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${activePath === null ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium" : "hover:bg-surface-hover text-muted"}`}>
                  学习路径总览
                </button>
              )}
              {scope.stages.map(stage => (
                <div key={stage.path} className="rounded-xl border bg-surface overflow-hidden">
                  <div className="px-3 py-2 bg-surface-subtle text-sm font-medium truncate">{stage.title}</div>
                  <div className="divide-y divide-border-subtle">
                    {stage.lessons.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-faint">该阶段还没有课时</div>
                    ) : stage.lessons.map(lesson => (
                      <button key={lesson.path} onClick={() => setActivePath(lesson.path)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-1.5 transition-colors ${activePath === lesson.path ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium" : "hover:bg-surface-hover text-muted"}`}>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{lesson.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </aside>

        {/* 右：正文 */}
        <main className="rounded-xl border bg-surface p-6 min-h-[400px]">
          {docLoading
            ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-faint" /></div>
            : content
              ? <MarkdownRenderer content={content} />
              : <div className="text-center text-faint py-16 text-sm">从左侧选择一个课时开始学习</div>}
        </main>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <GraduationCap className="h-6 w-6 text-sky-500" />学习库
      </h1>
      <p className="text-sm text-muted mt-1">按阶段组织的航模队内部学习资料 · 内容与知识库同源，可搜索、可备份</p>
    </div>
  );
}

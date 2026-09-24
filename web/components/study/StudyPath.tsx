"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { Clock, Target, Pencil, PlayCircle, BookOpen, Sparkles } from "lucide-react";
import type { StudyScope } from "@/lib/studyNav";

/**
 * 学习路径总览：把阶段渲染成**编号卡片**（时长 / 目标 / 课时清单），
 * 而不是一个光秃秃的目录盒子 —— 这是「学习系统」和「文件浏览器」的分界线。
 */
export function StudyPath({
  scope, onOpenLesson,
}: {
  scope: StudyScope;
  onOpenLesson: (path: string) => void;
}) {
  const total = scope.stages.reduce((n, s) => n + s.lessons.length, 0);

  return (
    <div className="space-y-6">
      {(scope.overview || scope.goal || scope.duration) && (
        <section className="rounded-2xl border bg-gradient-to-br from-sky-50 to-transparent dark:from-sky-950/40 p-6">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-sky-500" />学习路径
            </h2>
            {scope.duration && <Chip icon={<Clock className="h-3.5 w-3.5" />} text={scope.duration} />}
            <span className="text-xs text-faint">{scope.stages.length} 个阶段 · {total} 个课时</span>
          </div>
          {scope.goal && <p className="text-sm text-muted mb-3">🎯 {scope.goal}</p>}
          {scope.overview && <MarkdownRenderer content={scope.overview} />}
        </section>
      )}

      <ol className="space-y-4">
        {scope.stages.map((stage, i) => (
          <li key={stage.path} className="rounded-2xl border bg-surface overflow-hidden">
            <div className="flex items-start gap-4 p-5">
              <span className="shrink-0 w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">{stage.title}</h3>
                  {stage.duration && <Chip icon={<Clock className="h-3.5 w-3.5" />} text={stage.duration} />}
                  <span className="text-xs text-faint">{stage.lessons.length} 课时</span>
                </div>
                {stage.goal && (
                  <p className="text-sm text-muted flex items-start gap-1.5">
                    <Target className="h-4 w-4 shrink-0 mt-0.5 text-sky-500" />
                    <span>{stage.goal}</span>
                  </p>
                )}
                {stage.description && (
                  <details className="text-sm text-muted" open={i === 0}>
                    <summary className="cursor-pointer select-none text-xs text-faint hover:text-sky-500">阶段说明</summary>
                    <div className="mt-2">{<MarkdownRenderer content={stage.description} />}</div>
                  </details>
                )}
              </div>
            </div>

            <div className="border-t border-border-subtle divide-y divide-border-subtle">
              {stage.lessons.length === 0 ? (
                <div className="px-5 py-3 text-xs text-faint">该阶段还没有课时</div>
              ) : stage.lessons.map((lesson, j) => (
                <button key={lesson.path} onClick={() => onOpenLesson(lesson.path)}
                  className="w-full text-left px-5 py-2.5 flex items-center gap-3 text-sm hover:bg-surface-hover transition-colors group">
                  <span className="text-xs text-faint w-8 shrink-0">{i + 1}.{j + 1}</span>
                  <BookOpen className="h-4 w-4 shrink-0 text-faint group-hover:text-sky-500" />
                  <span className="flex-1 truncate">{lesson.title}</span>
                  <PlayCircle className="h-4 w-4 shrink-0 text-faint opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {scope.canEdit && (
        <Link href={`/admin/knowledge?path=${encodeURIComponent(scope.libraryPath)}`}
          className="inline-flex items-center gap-2 text-xs text-faint hover:text-sky-500">
          <Pencil className="h-3.5 w-3.5" />在知识库中编辑学习库内容
        </Link>
      )}
    </div>
  );
}

function Chip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] text-muted">
      {icon}{text}
    </span>
  );
}

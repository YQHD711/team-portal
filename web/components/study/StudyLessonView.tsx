"use client";

import Link from "next/link";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronLeft, ChevronRight, Pencil, List, ArrowLeft } from "lucide-react";
import { extractToc, lessonOrdinal, type StudyLesson, type StudyScope } from "@/lib/studyNav";

/** 课时阅读页：面包屑 + 正文 + 右侧大纲 + 上一课/下一课。 */
export function StudyLessonView({
  scope, stageTitle, lesson, content, loading, prev, next, total, onOpen, onBackToPath,
}: {
  scope: StudyScope;
  stageTitle: string;
  lesson: StudyLesson;
  content: string;
  loading: boolean;
  prev: StudyLesson | null;
  next: StudyLesson | null;
  total: number;
  onOpen: (path: string) => void;
  onBackToPath: () => void;
}) {
  const toc = extractToc(content);

  return (
    <div className="space-y-5">
      {/* 面包屑 + 工具 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={onBackToPath} className="inline-flex items-center gap-1 text-faint hover:text-sky-500">
          <ArrowLeft className="h-3.5 w-3.5" />学习路径
        </button>
        <span className="text-faint">/</span>
        <span className="text-faint">{stageTitle}</span>
        <span className="text-faint">/</span>
        <span className="text-foreground font-medium truncate">{lesson.title}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-faint">第 {lessonOrdinal(scope.stages, lesson.path)} / {total} 课</span>
          {lesson.canEdit && (
            <Link href={`/admin/knowledge?path=${encodeURIComponent(lesson.path)}`}
              className="inline-flex items-center gap-1 text-faint hover:text-sky-500">
              <Pencil className="h-3.5 w-3.5" />编辑
            </Link>
          )}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_180px]">
        <article className="rounded-2xl border bg-surface p-6 sm:p-8 min-h-[400px]">
          {loading
            ? <div className="text-center text-faint py-16 text-sm">加载中…</div>
            : content
              ? <MarkdownRenderer content={content} />
              : <div className="text-center text-faint py-16 text-sm">这份文档还是空的</div>}
        </article>

        {toc.length > 0 && (
          <nav className="hidden lg:block">
            <div className="sticky top-6 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-muted mb-2">
                <List className="h-3.5 w-3.5" />本课大纲
              </div>
              <ul className="space-y-1 border-l border-border pl-3">
                {toc.map(t => (
                  <li key={t.id} className={t.level === 3 ? "pl-3" : ""}>
                    <a href={`#${t.id}`} className="text-faint hover:text-sky-500 line-clamp-2">{t.text}</a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        )}
      </div>

      {/* 上一课 / 下一课 */}
      <div className="flex items-stretch gap-3">
        {prev ? (
          <button onClick={() => onOpen(prev.path)}
            className="flex-1 text-left rounded-xl border p-3 hover:border-sky-400 hover:bg-surface-hover transition-colors group">
            <span className="text-[11px] text-faint inline-flex items-center gap-1"><ChevronLeft className="h-3 w-3" />上一课</span>
            <div className="text-sm font-medium truncate group-hover:text-sky-500">{prev.title}</div>
          </button>
        ) : <div className="flex-1" />}
        {next ? (
          <button onClick={() => onOpen(next.path)}
            className="flex-1 text-right rounded-xl border p-3 hover:border-sky-400 hover:bg-surface-hover transition-colors group">
            <span className="text-[11px] text-faint inline-flex items-center gap-1 justify-end w-full">下一课<ChevronRight className="h-3 w-3" /></span>
            <div className="text-sm font-medium truncate group-hover:text-sky-500">{next.title}</div>
          </button>
        ) : (
          <div className="flex-1 rounded-xl border border-dashed p-3 text-center text-xs text-faint self-center">
            已经是最后一课了
          </div>
        )}
      </div>
    </div>
  );
}

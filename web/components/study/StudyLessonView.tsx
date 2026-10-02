"use client";

import { useEffect, useRef } from "react";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronLeft, ChevronRight, List, ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { findAnchorTarget } from "@/lib/docAnchor";
import { HIGHLIGHT_TESTID } from "@/lib/mdHighlight";
import { extractToc, lessonOrdinal, type StudyLesson, type StudyScope } from "@/lib/studyNav";

/** 课时阅读页：面包屑 + 正文 + 右侧大纲 + 上一课/下一课 + 完成勾选。 */
export function StudyLessonView({
  scope, stageTitle, lesson, content, loading, prev, next, total, onOpen, onBackToPath, onToggle,
  highlight, scrollToId,
}: {
  scope: StudyScope;
  stageTitle: string;
  lesson: StudyLesson;
  content: string;
  loading: boolean;
  prev: StudyLesson | null;
  next: StudyLesson | null;
  total: number;
  onOpen: (path: string, hash?: string) => void;
  onBackToPath: () => void;
  onToggle: (completed: boolean) => void;
  /** 搜索关键词：正文命中处高亮，并滚到第一处命中 */
  highlight?: string;
  /** 链接带来的 #锚点：正文到位后滚到那一节 */
  scrollToId?: string | null;
}) {
  const toc = extractToc(content);
  const articleRef = useRef<HTMLElement>(null);

  /**
   * 决定滚动落点：① 锚点 → ② 第一处搜索命中 → ③ 正文开头。
   *
   * 以前只在 lesson.path 变化时滚到开头：那一刻渲染的还是**上一篇**的正文（或"加载中"占位），
   * 等新正文（可能更短）替换进来后，浏览器把滚动位置钳到新的最大值 —— 这就是
   * "点进去落在文末"。所以这里必须等 content 也到位再滚。
   */
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const anchor = scrollToId ? findAnchorTarget(article, scrollToId) : null;
    const hit = !anchor && highlight ? article.querySelector<HTMLElement>(`[data-testid="${HIGHLIGHT_TESTID}"]`) : null;
    (anchor ?? hit ?? article).scrollIntoView({ block: "start" });
  }, [lesson.path, content, scrollToId, highlight]);

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
          <button onClick={() => onToggle(!lesson.completed)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${lesson.completed
              ? "border-success/40 bg-success/10 text-success"
              : "text-faint hover:text-sky-500 hover:border-sky-400"}`}>
            {lesson.completed
              ? <><CheckCircle2 className="h-3.5 w-3.5" />已完成</>
              : <><Circle className="h-3.5 w-3.5" />标记完成</>}
          </button>
        </span>
      </div>

      {/*
        min-w-0 不能省：grid 项默认 min-width:auto，正文里一张宽表格/一行长代码
        就能把 1fr 撑到内容宽度，整页出现横向滚动条（1440 下溢出 118px、
        1280 下溢出 278px），右侧大纲被挤出屏幕外。min-w-0 让 1fr 能收缩，
        宽内容交给 prose 自身的 overflow-x-auto。
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_180px]">
        <article ref={articleRef} className="min-w-0 scroll-mt-16 rounded-2xl border bg-surface p-6 sm:p-8 min-h-[400px]">
          {loading
            ? <div className="text-center text-faint py-16 text-sm">加载中…</div>
            : content
              ? <MarkdownRenderer content={content} docPath={lesson.path} onNavigate={onOpen} highlight={highlight} />
              : <div className="text-center text-faint py-16 text-sm">这份文档还是空的</div>}
        </article>

        {toc.length > 0 && (
          <nav className="hidden lg:block min-w-0">
            <div className="sticky top-6 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-muted mb-2">
                <List className="h-3.5 w-3.5" />本课大纲
              </div>
              <ul className="space-y-1 border-l border-border pl-3">
                {toc.map(t => (
                  <li key={t.id} className={t.level === 3 ? "pl-3" : ""}>
                    <a href={`#${t.id}`} className="block text-faint hover:text-sky-500 line-clamp-2">{t.text}</a>
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

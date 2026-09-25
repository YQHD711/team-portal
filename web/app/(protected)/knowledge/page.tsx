"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { BookOpen, ChevronRight, Loader2, Pencil, GraduationCap } from "lucide-react";

/** 读 URL 查询参数（SSR 时没有 window）。 */
function urlParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

/** 是不是学习库里的文档（路径里有「学习库」目录段）。 */
function isStudyDoc(path: string): boolean {
  return path.split("/").filter(Boolean).includes("学习库");
}

/**
 * 知识库文档阅读页（**非管理端**）。
 *
 * 存在的理由：知识库编辑器在 /admin/knowledge 下，而 AuthGuard 会把非 staff 从
 * /admin/* 踢回首页 —— 队员从全局搜索点一份资料，结果是"跳回首页"，等于搜到了也打不开。
 * 这里给所有登录用户一个只读入口：内容接口 /api/knowledge/content 自身按部门/公共做 ACL，
 * 拿不到就是 403/404，页面如实说明。
 */
export default function KnowledgeReaderPage() {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const { user } = useCurrentUser();
  const canEdit = user?.role === "admin" || user?.role === "部长";

  useEffect(() => {
    const p = urlParam("path");
    setPath(p);
    if (!p) { setState("error"); setError("没有指定文档"); return; }
    let cancelled = false;
    setState("loading");
    api.get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(p)}`)
      .then(r => { if (!cancelled) { setContent(r.content ?? ""); setState("ok"); } })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "读取失败";
        setError(msg.includes("403") ? "你的账号没有这份文档的权限（部门/可见范围限制）" : msg);
        setState("error");
      });
    return () => { cancelled = true; };
  }, []);

  const segments = path.split("/").filter(Boolean);
  const crumb = segments.slice(0, -1);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
        <Link href="/" className="hover:text-sky-500">首页</Link>
        <ChevronRight className="h-3 w-3" />
        {isStudyDoc(path) && (
          <>
            <Link href="/study" className="inline-flex items-center gap-1 hover:text-sky-500">
              <GraduationCap className="h-3.5 w-3.5" />学习库
            </Link>
            <ChevronRight className="h-3 w-3" />
          </>
        )}
        {crumb.map((seg, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span>{seg}</span><ChevronRight className="h-3 w-3" />
          </span>
        ))}
        <span className="font-medium text-foreground truncate">{segments[segments.length - 1] ?? ""}</span>
        {canEdit && path && (
          <Link href={`/admin/knowledge?path=${encodeURIComponent(path)}`}
            className="ml-auto inline-flex items-center gap-1 text-faint hover:text-sky-500">
            <Pencil className="h-3.5 w-3.5" />编辑
          </Link>
        )}
      </nav>

      {state === "loading" && (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border bg-surface p-10 text-center space-y-2">
          <BookOpen className="h-8 w-8 mx-auto text-faint" />
          <div className="text-sm font-medium">打不开这份文档</div>
          <p className="text-xs text-muted break-all">{error}{path ? `：${path}` : ""}</p>
        </div>
      )}

      {state === "ok" && (
        <article className="rounded-2xl border bg-surface p-6 sm:p-8 min-h-[400px]">
          {content
            ? <MarkdownRenderer content={content} docPath={path} />
            : <div className="text-center text-faint py-16 text-sm">这份文档还是空的</div>}
        </article>
      )}
    </div>
  );
}

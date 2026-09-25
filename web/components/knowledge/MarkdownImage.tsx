"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { knowledgeAssetUrl, looksLikeFileName, isRemoteAsset, resolveAssetPath } from "@/lib/markdownAssets";

interface Props {
  src?: string;
  alt?: string;
  /** 当前文档在知识库里的相对路径，用来解析相对图片地址 */
  docPath?: string;
}

/**
 * 知识库图片。
 *
 * `<img src="/api/knowledge/download?...">` 是行不通的：JWT 存在 localStorage，
 * 浏览器给图片请求**不会**附带 Authorization 头，只会 401。所以这里带鉴权把图片
 * 取回来变成 blob URL 再显示。外链图片（http/https）直接引用，不走这一步。
 */
export function MarkdownImage({ src, alt, docPath }: Props) {
  const remote = !!src && (isRemoteAsset(src) || src.startsWith("data:"));
  const resolved = remote ? null : resolveAssetPath(src, docPath);
  const requestUrl = remote
    ? null
    : src?.startsWith("/api/")
      ? src
      : resolved
        ? knowledgeAssetUrl(resolved)
        : null;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!requestUrl) return;
    let cancelled = false;
    let created: string | null = null;
    setBlobUrl(null);
    setFailed(false);
    api.download(requestUrl)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [requestUrl]);

  const caption = alt && !looksLikeFileName(alt) ? alt : null;

  // 解析不出路径（空 src / 只有锚点）或读取失败：给一个能看出问题的占位，别静默空白
  if (failed || (!remote && !requestUrl)) {
    return (
      <span className="my-4 flex flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-surface-subtle px-4 py-6 text-center">
        <span className="text-xs text-muted">图片加载失败</span>
        <span className="text-[11px] text-faint break-all">{alt || src || "（未写图片地址）"}</span>
        {resolved && <span className="text-[11px] text-faint break-all">知识库路径：{resolved}</span>}
      </span>
    );
  }

  const finalSrc = remote ? src! : blobUrl;

  return (
    <figure className="my-5">
      {finalSrc ? (
        <button
          type="button"
          onClick={() => window.open(finalSrc, "_blank", "noopener,noreferrer")}
          title="点击查看原图"
          className="group block w-full cursor-zoom-in rounded-xl border border-border bg-surface-subtle p-1 transition-colors hover:border-sky-400"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={finalSrc}
            alt={alt ?? ""}
            loading="lazy"
            className="mx-auto block max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
          />
        </button>
      ) : (
        <span className="block h-40 w-full animate-pulse rounded-xl border border-border bg-surface-subtle" />
      )}
      {caption && <figcaption className="mt-2 text-center text-xs text-faint">{caption}</figcaption>}
    </figure>
  );
}

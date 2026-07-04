"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { TreeView } from "@/components/knowledge/TreeView";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface TreeNode {
  name: string;
  type: "folder" | "file";
  path?: string;
  children?: TreeNode[];
}

export default function KnowledgePage() {
  const params = useParams();
  const slug = params.slug as string[] | undefined;
  const filePath = slug ? slug.join("/") : null;

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    api
      .get<TreeNode[]>("/api/knowledge/tree")
      .then(setTree)
      .catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .get<{ content: string }>(`/api/knowledge/content?path=${encodeURIComponent(filePath + ".md")}`)
      .then((data) => setContent(data.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [filePath]);

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-6">
      <div
        className={`border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto transition-all duration-200 ${
          sidebarOpen ? "w-64" : "w-0 border-r-0"
        }`}
      >
        <div className="p-3">
          <TreeView nodes={tree} />
        </div>
      </div>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="shrink-0 flex items-center justify-center w-6 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-r border-zinc-200 dark:border-zinc-800"
        aria-label={sidebarOpen ? "关闭目录" : "打开目录"}
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
      </button>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3" />
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3" />
            <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-1/2" />
          </div>
        ) : content ? (
          <MarkdownRenderer content={content} />
        ) : filePath ? (
          <div className="text-center py-16 text-zinc-500">文件未找到</div>
        ) : (
          <div className="text-center py-16 text-zinc-500">
            请从左侧目录选择要查看的文档
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronRight, Folder, FileText, BookOpen, File, Image, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

interface TreeNode {
  name: string;
  type: "folder" | "file" | "wiki";
  path?: string;
  children?: TreeNode[];
  extra?: Record<string, string>;
}

interface TreeViewProps {
  nodes: TreeNode[];
  level?: number;
}

const ICON_MAP: Record<string, typeof File> = {
  ".pdf": File, ".doc": File, ".docx": File,
  ".xls": FileSpreadsheet, ".xlsx": FileSpreadsheet,
  ".jpg": Image, ".jpeg": Image, ".png": Image, ".gif": Image, ".webp": Image,
  ".ppt": File, ".pptx": File,
};
const ICON_COLOR = "text-warning dark:text-amber-400";
const TEXT_EXTS = new Set([".md", ".txt", ".csv", ".json", ".xml", ".html", ".css", ".js", ".ts", ".py", ".cs"]);

function getExt(path?: string): string {
  if (!path) return "";
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function isTextFile(path?: string): boolean {
  return TEXT_EXTS.has(getExt(path));
}

function FileLink({ node }: { node: TreeNode }) {
  const ext = getExt(node.path);
  const Icon = ICON_MAP[ext] || FileText;

  if (isTextFile(node.path)) {
    const href = node.path
      ? `/admin/knowledge/${node.path.replace(/\.\w+$/, "").split("/").map(s => encodeURIComponent(s)).join("/")}`
      : "#";
    return (
      <Link href={href}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors">
        <span className="w-4 shrink-0" />
        <Icon className={`h-4 w-4 shrink-0 ${ext ? ICON_COLOR : "text-faint"}`} />
        <span className="truncate">{node.name}</span>
        {ext && <span className="text-xs text-faint ml-auto">{ext}</span>}
      </Link>
    );
  }

  // Binary file — download link
  const downloadUrl = node.path
    ? `/api/knowledge/download?path=${encodeURIComponent(node.path)}`
    : "#";
  return (
    <a href={downloadUrl} target="_blank" rel="noopener"
      className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors">
      <span className="w-4 shrink-0" />
      <Icon className={`h-4 w-4 shrink-0 ${ICON_COLOR}`} />
      <span className="truncate">{node.name}</span>
      <span className="text-xs text-faint ml-auto">{ext}</span>
    </a>
  );
}

export function TreeView({ nodes, level = 0 }: TreeViewProps) {
  return (
    <ul className={level === 0 ? "space-y-0.5" : "ml-4 space-y-0.5"}>
      {nodes.map((node) => (
        <TreeNodeItem key={node.name + (node.path ?? "")} node={node} level={level} />
      ))}
    </ul>
  );
}

function TreeNodeItem({ node, level }: { node: TreeNode; level: number }) {
  const [expanded, setExpanded] = useState(level === 0);

  if (node.type === "wiki") {
    return (
      <li>
        <Link
          href={`/wiki/${node.extra?.taskId ?? ""}`}
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors text-sky-600 dark:text-sky-400"
        >
          <span className="w-4 shrink-0" />
          <BookOpen className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">{node.name}</span>
          <span className="text-xs text-faint ml-auto">Wiki</span>
        </Link>
      </li>
    );
  }

  if (node.type === "folder") {
    return (
      <li>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm text-left hover:bg-surface-hover transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-faint transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <Folder className="h-4 w-4 shrink-0 text-faint" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children && node.children.length > 0 && (
          <TreeView nodes={node.children} level={level + 1} />
        )}
      </li>
    );
  }

  return (
    <li>
      <FileLink node={node} />
    </li>
  );
}

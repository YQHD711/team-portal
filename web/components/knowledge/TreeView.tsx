"use client";

import Link from "next/link";
import { ChevronRight, Folder, FileText } from "lucide-react";
import { useState } from "react";

interface TreeNode {
  name: string;
  type: "folder" | "file";
  path?: string;
  children?: TreeNode[];
}

interface TreeViewProps {
  nodes: TreeNode[];
  level?: number;
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
  const isFolder = node.type === "folder";

  if (isFolder) {
    return (
      <li>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
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
      <Link
        href={node.path ? `/knowledge/${node.path.replace(".md", "")}` : "#"}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="w-4 shrink-0" />
        <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="truncate">{node.name}</span>
      </Link>
    </li>
  );
}

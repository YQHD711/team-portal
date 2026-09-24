"use client";

import { ChevronRight, FileText, Folder, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { allFolderKeys, nodeKey, type TreeNode } from "@/lib/knowledgeTree";

/**
 * 可折叠的知识库目录树。
 *
 * 展开态由父组件持有 —— 这样「?path= 深链接自动展开父链」和这里的点击展开
 * 用的是同一份状态，不会两套真相。
 */
export function KnowledgeTree({
  nodes, selected, canEdit, role, expanded, onExpandedChange, onOpenFile, onRename, onDelete,
}: {
  nodes: TreeNode[];
  selected: string | null;
  canEdit: boolean;
  role?: string;
  expanded: Set<string>;
  onExpandedChange: (next: Set<string>) => void;
  onOpenFile: (node: TreeNode) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (path: string) => void;
}) {
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onExpandedChange(next);
  };

  const render = (list: TreeNode[], level: number) => (
    <ul className={level === 0 ? "space-y-0.5" : "ml-3 space-y-0.5"}>
      {list.map(n => {
        const key = nodeKey(n);
        const hasChildren = !!n.children?.length;
        const isOpen = expanded.has(key);
        const isWiki = n.type === "wiki";
        const isFolder = n.type === "folder" || isWiki;

        return (
          <li key={n.name + (n.path ?? "")}>
            <div className={cn(
              "flex items-center gap-1 rounded px-1 py-0.5 group hover:bg-surface-hover",
              !isFolder && "cursor-pointer",
              selected === n.path && "bg-sky-50 dark:bg-sky-950 text-sky-700",
            )}>
              {hasChildren ? (
                <button type="button" onClick={() => toggle(key)} aria-expanded={isOpen}
                  aria-label={`${isOpen ? "折叠" : "展开"} ${n.name}`}
                  className="shrink-0 p-0.5 text-faint hover:text-foreground">
                  <ChevronRight className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")} />
                </button>
              ) : <span className="w-4 shrink-0" />}

              {isFolder ? (
                <>
                  <button type="button" onClick={() => toggle(key)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500/70" />
                    <span className="text-xs font-medium truncate">{n.name}/</span>
                    {isWiki && <span className="text-[10px] text-faint shrink-0">Wiki</span>}
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => onRename(n)} className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-primary shrink-0" title="重命名"><Pencil className="h-3 w-3" /></button>
                      <button onClick={() => onDelete(n.path ?? n.name)} className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-danger shrink-0" title="删除文件夹"><Trash2 className="h-3 w-3" /></button>
                    </>
                  )}
                </>
              ) : (
                <div role="button" tabIndex={0} onClick={() => onOpenFile(n)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenFile(n); } }}
                  className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-sm">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
                  <span className="truncate">{n.name}</span>
                  {canEdit && <button onClick={(e) => { e.stopPropagation(); onRename(n); }} className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-primary shrink-0" title="重命名"><Pencil className="h-3 w-3" /></button>}
                  {canEdit && <button onClick={(e) => { e.stopPropagation(); onDelete(n.path ?? n.name); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-danger shrink-0" title="删除"><Trash2 className="h-3 w-3" /></button>}
                </div>
              )}
            </div>

            {hasChildren && isOpen && render(n.children!, level + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-2 px-1 gap-2">
        <span className="text-xs font-medium text-faint">目录树</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onExpandedChange(new Set(allFolderKeys(nodes)))}
            className="text-[10px] text-faint hover:text-sky-500">全部展开</button>
          <span className="text-[10px] text-faint">·</span>
          <button onClick={() => onExpandedChange(new Set())}
            className="text-[10px] text-faint hover:text-sky-500">全部收起</button>
          {role && <span className="text-[10px] text-faint ml-1">{role}</span>}
        </div>
      </div>
      {render(nodes, 0)}
    </>
  );
}

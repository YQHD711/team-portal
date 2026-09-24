/** 知识库目录树的纯逻辑（可单测）：展开态、路径解析、找首个可编辑文件。 */

export interface TreeNode {
  name: string;
  type: "folder" | "file" | "wiki";
  path?: string;
  children?: TreeNode[];
  extra?: Record<string, string>;
}

/** 可在编辑器里打开的文本类型；其它类型走下载。 */
export const TEXT_EXTS = [".md", ".txt", ".csv", ".json", ".xml"];

export function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTS.some(e => lower.endsWith(e));
}

/** 路径的所有上级目录，从浅到深：`公共/学习库/01/x.md` → [`公共`, `公共/学习库`, `公共/学习库/01`]。 */
export function ancestorFolders(path: string): string[] {
  const segs = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

/** 节点在树里的唯一键（路径优先，退化到名字）。 */
export function nodeKey(node: TreeNode): string {
  return node.path ?? node.name;
}

/** 按路径在树里找节点。 */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 目录下的第一个可编辑文件。
 * 顺序：**先看本目录自己的文件**，再依次下钻子目录 ——
 * 于是「编辑本库」会先打开 `_学习路径.md` 这类入口文档，而不是一头扎进第一个阶段。
 */
export function firstFileIn(node: TreeNode): string | null {
  const children = node.children ?? [];
  const direct = children.find(c => c.type === "file" && c.path && isTextFile(c.path));
  if (direct?.path) return direct.path;

  for (const child of children) {
    if (child.type === "folder" || child.type === "wiki") {
      const found = firstFileIn(child);
      if (found) return found;
    }
  }
  return null;
}

/** 给定一个可能的目录路径，返回该目录下的第一个可编辑文件；找不到返回 null。 */
export function findFirstFile(nodes: TreeNode[], folderPath: string): string | null {
  const node = findNode(nodes, folderPath);
  return node ? firstFileIn(node) : null;
}

/** 树里所有有子节点的目录键（供"全部展开"用）。 */
export function allFolderKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.children?.length) {
        keys.push(nodeKey(n));
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

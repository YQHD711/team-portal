import { describe, it, expect } from "vitest";
import { allFolderKeys, ancestorFolders, findFirstFile, findNode, isTextFile, nodeKey, type TreeNode } from "@/lib/knowledgeTree";

const file = (name: string, path: string): TreeNode => ({ name, type: "file", path, extra: { ext: ".md" } });

/** 与真实扫描一致：目录在前，文件在后。 */
const 学习库: TreeNode = {
  name: "学习库", type: "folder", path: "公共/学习库",
  children: [
    {
      name: "01-入门筑基", type: "folder", path: "公共/学习库/01-入门筑基",
      children: [file("01-认识航模", "公共/学习库/01-入门筑基/01-认识航模.md")],
    },
    file("_学习路径", "公共/学习库/_学习路径.md"),
  ],
};

const tree: TreeNode[] = [
  { name: "公共知识库", type: "folder", path: "公共", children: [学习库, { name: "空的", type: "folder", path: "公共/空的", children: [] }] },
  { name: "无路径节点", type: "folder" },
];

describe("知识库目录树（纯逻辑）", () => {
  it("识别可编辑的文本类型，其它走下载", () => {
    expect(isTextFile("a/b.md")).toBe(true);
    expect(isTextFile("a/b.CSV")).toBe(true);
    expect(isTextFile("a/b.pdf")).toBe(false);
    expect(isTextFile("a/b")).toBe(false);
  });

  it("上级目录链从浅到深（用于自动展开）", () => {
    expect(ancestorFolders("公共/学习库/01-入门筑基/01-认识航模.md"))
      .toEqual(["公共", "公共/学习库", "公共/学习库/01-入门筑基"]);
    expect(ancestorFolders("公共/学习库")).toEqual(["公共"]);
    expect(ancestorFolders("root.md")).toEqual([]);
  });

  it("按路径找节点；找不到返回 null", () => {
    expect(findNode(tree, "公共/学习库")?.name).toBe("学习库");
    expect(findNode(tree, "公共/学习库/不存在")).toBeNull();
  });

  it("目录下第一个可编辑文件：**优先本目录自己的文件**，而不是一头扎进第一个子目录", () => {
    // 真实扫描是"目录在前、文件在后"，所以这里必须靠规则而非顺序
    expect(findFirstFile(tree, "公共/学习库")).toBe("公共/学习库/_学习路径.md");
  });

  it("目录自己没文件时下钻子目录", () => {
    expect(findFirstFile(tree, "公共/学习库/01-入门筑基")).toBe("公共/学习库/01-入门筑基/01-认识航模.md");
  });

  it("空目录 / 不存在的路径 → null（调用方据此给提示而不是静默空白）", () => {
    expect(findFirstFile(tree, "公共/空的")).toBeNull();
    expect(findFirstFile(tree, "根本不存在")).toBeNull();
  });

  it("全部展开只收有子节点的目录", () => {
    const keys = allFolderKeys(tree);

    expect(keys).toContain("公共");
    expect(keys).toContain("公共/学习库");
    expect(keys).toContain("公共/学习库/01-入门筑基");
    expect(keys).not.toContain("公共/空的");   // 没有子节点，不用展开
  });

  it("节点键用路径，缺路径时退回名字（保证折叠状态唯一）", () => {
    expect(nodeKey(学习库)).toBe("公共/学习库");
    expect(nodeKey({ name: "无路径节点", type: "folder" })).toBe("无路径节点");
  });
});

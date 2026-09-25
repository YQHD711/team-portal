import { describe, it, expect } from "vitest";
import { isExternalUrl, isRemoteAsset, knowledgeAssetUrl, looksLikeFileName, resolveAssetPath } from "@/lib/markdownAssets";

/**
 * 文档里的相对图片地址解析。
 *
 * 原始缺陷：知识库文档写 `![](示意图.png)`，浏览器按**页面 URL** 解析成
 * `/study/示意图.png` → 404，图片永远显示不出来。必须按文档所在目录解析成
 * 知识库相对路径，再走带鉴权的下载接口。
 */
describe("markdown 资源路径解析", () => {
  const doc = "电子部/学习库/01-编程语言基础/01-C++入门与实践.md";

  it("同目录相对名 → 文档所在目录", () => {
    expect(resolveAssetPath("示意图.png", doc)).toBe("电子部/学习库/01-编程语言基础/示意图.png");
  });

  it("./ 前缀等价", () => {
    expect(resolveAssetPath("./img/流程.png", doc)).toBe("电子部/学习库/01-编程语言基础/img/流程.png");
  });

  it("../ 往上一级", () => {
    expect(resolveAssetPath("../公共/logo.png", doc)).toBe("电子部/学习库/公共/logo.png");
  });

  it("以 / 开头视为知识库根", () => {
    expect(resolveAssetPath("/公共/logo.png", doc)).toBe("公共/logo.png");
  });

  it("越出知识库根 → null（不许穿到宿主目录）", () => {
    expect(resolveAssetPath("../../../../etc/passwd", doc)).toBeNull();
  });

  it("锚点/空值/undefined 都不是图片路径", () => {
    expect(resolveAssetPath("#section", doc)).toBeNull();
    expect(resolveAssetPath("", doc)).toBeNull();
    expect(resolveAssetPath(undefined, doc)).toBeNull();
    expect(resolveAssetPath("   ", doc)).toBeNull();
  });

  it("去掉 ?query 与 #hash", () => {
    expect(resolveAssetPath("图.png?v=2#top", doc)).toBe("电子部/学习库/01-编程语言基础/图.png");
  });

  it("百分号编码的中文名先解码", () => {
    expect(resolveAssetPath("%E7%A4%BA%E6%84%8F%E5%9B%BE.png", doc)).toBe("电子部/学习库/01-编程语言基础/示意图.png");
  });

  it("没有文档路径时按知识库根解析", () => {
    expect(resolveAssetPath("图.png")).toBe("图.png");
  });

  it("外链与 data:/blob: 不走知识库解析", () => {
    expect(isRemoteAsset("https://example.com/a.png")).toBe(true);
    expect(isRemoteAsset("//cdn.example.com/a.png")).toBe(true);
    expect(isRemoteAsset("data:image/png;base64,AAA")).toBe(true);
    expect(isRemoteAsset("blob:http://x/y")).toBe(true);
    expect(isRemoteAsset("图.png")).toBe(false);
    expect(isRemoteAsset("/公共/图.png")).toBe(false);
  });

  it("外链判定覆盖 http(s)/协议相对/mailto/tel", () => {
    expect(isExternalUrl("http://a")).toBe(true);
    expect(isExternalUrl("https://a")).toBe(true);
    expect(isExternalUrl("//a/b")).toBe(true);
    expect(isExternalUrl("mailto:a@b")).toBe(true);
    expect(isExternalUrl("#anchor")).toBe(false);
    expect(isExternalUrl("/公共/图.png")).toBe(false);
  });

  it("下载地址对路径做完整编码（含 / 与中文）", () => {
    expect(knowledgeAssetUrl("电子部/学习库/图 1.png"))
      .toBe("/api/knowledge/download?path=" + encodeURIComponent("电子部/学习库/图 1.png"));
  });

  it("alt 是文件名时不拿它当图注", () => {
    expect(looksLikeFileName("示意图.png")).toBe(true);
    expect(looksLikeFileName("接线示意")).toBe(false);
  });
});

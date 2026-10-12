import { describe, it, expect } from "vitest";
import { datedFilename, downloadErrorMessage, filenameFromPath } from "@/lib/download";

/** 共用下载小工具：文件名规则 + 401 不当成"失败"提示。 */

describe("filenameFromPath", () => {
  it("取路径末段（知识库 PDF 用）", () => {
    expect(filenameFromPath("公共/Pixhawk标准/DS-009 Pixhawk Connector Standard.pdf")).toBe("DS-009 Pixhawk Connector Standard.pdf");
    expect(filenameFromPath("a/b/c.md")).toBe("c.md");
    expect(filenameFromPath("no-slash.pdf")).toBe("no-slash.pdf");
  });

  it("空路径 / 尾斜杠 / 空白：给安全兜底名", () => {
    expect(filenameFromPath("")).toBe("download");
    expect(filenameFromPath("a/b/")).toBe("b");
    expect(filenameFromPath("   ")).toBe("download");
  });
});

describe("datedFilename（客户端默认名，与后端一致）", () => {
  it("operations-YYYYMMDD.csv / logs-YYYYMMDD.csv", () => {
    const d = new Date(2026, 9, 2);   // 2026-10-02（本地时区）
    expect(datedFilename("operations", "csv", d)).toBe("operations-20261002.csv");
    expect(datedFilename("logs", "csv", d)).toBe("logs-20261002.csv");
    expect(datedFilename("x", "csv", new Date(2026, 0, 9))).toBe("x-20260109.csv");
  });
});

describe("downloadErrorMessage（401 不该弹出「下载失败」）", () => {
  it("登录过期 → null（helper 已跳登录，页面别提示）", () => {
    expect(downloadErrorMessage(new Error("登录已过期，请重新登录"))).toBeNull();
  });

  it("其它错误 → 可读文案；无 message 时兜底", () => {
    expect(downloadErrorMessage(new Error("文档不存在"))).toBe("文档不存在");
    expect(downloadErrorMessage(new Error(""))).toBe("下载失败");
    expect(downloadErrorMessage("boom")).toBe("下载失败");
  });
});

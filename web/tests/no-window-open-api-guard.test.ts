import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 鉴权下载守卫（防回归）。
 *
 * 回归的原始缺陷：JWT 存在 localStorage，用 window.open 打开 `/api/...` 这种新标签页
 * **发不出 Authorization 头** → 知识库 PDF、操作日志/请求日志导出全部 401。
 * 鉴权下载必须走 `api.download()`（内部 fetch 带 token + 进度 + idle 超时 + 401 跳登录）。
 *
 * 放行规则：只拦「第一个参数是字面量/模板串、且以 `/api/` 开头」的 window.open。
 * 例：`MarkdownImage.tsx` 的 `window.open(finalSrc, …)` 是 blob/资源 URL（变量），必须放行。
 */

const webRoot = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "playwright-report", ".turbo", "coverage"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** window.open( 之后紧跟以 /api/ 开头的字符串或模板字面量 */
const OPEN_API = /window\.open\(\s*[`"']\/api\//;

describe("window.open 不得用于鉴权下载接口", () => {
  const files = walk(webRoot);

  it("扫描范围非空（守卫不是空转）", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(f => f.endsWith("MarkdownImage.tsx"))).toBe(true);
  });

  it("没有任何 window.open 的第一个参数以 /api/ 开头", () => {
    const offenders = files
      .filter(f => OPEN_API.test(readFileSync(f, "utf8")))
      .map(f => relative(webRoot, f).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("放行 blob/资源 URL：MarkdownImage 的 window.open(变量) 不被误伤", () => {
    const src = readFileSync(join(webRoot, "components/knowledge/MarkdownImage.tsx"), "utf8");

    expect(src).toContain("window.open(finalSrc");
    expect(OPEN_API.test(src)).toBe(false);
  });
});

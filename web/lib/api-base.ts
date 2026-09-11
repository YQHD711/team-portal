/** api 客户端共用的基础项（拆出来避免 lib/api.ts 与其拆分模块循环引用）。 */

export const API_BASE = ""; // Relative URL — proxied through Next.js rewrites

export function isBrowser() {
  return typeof window !== "undefined";
}

/**
 * **成员级明暗偏好**（task：明暗深浅由队员在顶栏自行切换）。
 *
 * 设计要点：
 * - **三态**：`light` / `dark` / `auto`（auto = 跟随系统 `prefers-color-scheme`）。
 * - **持久化双写**：cookie（服务端可读，供 `layout.tsx` 首帧渲染正确 class、**不闪**）+ localStorage（客户端即时）。
 * - **服务端渲染才是真相**：<html class="dark"> 由 layout 从 cookie 解析后渲染，而不是客户端 useEffect 后补
 *   ——（同一类错误此前在品牌主色上出现过：客户端 imperative 写入会被 React/后续渲染抹掉）。
 * - `auto` 在服务端**不加** dark class；由 `layout.tsx` 内联的极小脚本在首帧前按 `matchMedia` 补上（避免闪）。
 * - **不碰品牌主色**：品牌色是 `<html style="--primary:…">` 内联样式，与 class 互不覆盖（本模块只管 class）。
 */

export type SchemePreference = "light" | "dark" | "auto";

export const SCHEME_COOKIE = "scheme";
export const SCHEME_STORAGE_KEY = "ui-scheme";
/** 与现状观感一致：未设置时默认深色 */
export const DEFAULT_SCHEME: SchemePreference = "dark";

/** 宽松解析：非法/缺失 → 默认值（服务端 cookie 与客户端 localStorage 共用） */
export function parseScheme(raw: string | null | undefined): SchemePreference {
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return DEFAULT_SCHEME;
}

/** 结合系统偏好，解析出**实际**明暗（`auto` 时看系统） */
export function resolveScheme(pref: SchemePreference, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "auto") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** 服务端渲染用：是否需要 `dark` class（`auto` 时服务端默认浅色，客户端首帧前脚本会按系统补） */
export function serverDarkClass(pref: SchemePreference): string {
  return pref === "dark" ? " dark" : "";
}

/** 三态循环顺序（顶栏点一下切到下一个） */
export function nextScheme(current: SchemePreference): SchemePreference {
  return current === "dark" ? "light" : current === "light" ? "auto" : "dark";
}

export function schemeLabel(pref: SchemePreference): string {
  return pref === "dark" ? "深色" : pref === "light" ? "浅色" : "跟随系统";
}

/** 写 cookie（带 path/有效期；SameSite=Lax 足够，非敏感偏好） */
export function writeSchemeCookie(pref: SchemePreference, maxAgeDays = 365): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SCHEME_COOKIE}=${pref};path=/;max-age=${maxAgeDays * 86400};SameSite=Lax`;
}

/** 客户端应用：写 cookie + localStorage + 立即切 class（品牌内联 style 不动） */
export function applyScheme(pref: SchemePreference, systemPrefersDark = false): void {
  writeSchemeCookie(pref);
  if (typeof localStorage !== "undefined") localStorage.setItem(SCHEME_STORAGE_KEY, pref);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolveScheme(pref, systemPrefersDark) === "dark");
  }
}

/** 读客户端已存偏好（缺失回默认） */
export function readStoredScheme(): SchemePreference {
  if (typeof localStorage === "undefined") return DEFAULT_SCHEME;
  return parseScheme(localStorage.getItem(SCHEME_STORAGE_KEY));
}

/**
 * `auto` 的**无闪烁**兜底脚本（内联在 <head>，首帧前执行）：
 * 读 cookie；只有当偏好为 `auto` 且系统是深色时才补 `dark`，其他情况服务端已经渲染对了。
 */
export const AUTO_SCHEME_SNIPPET =
  "(function(){try{var m=document.cookie.match(/(?:^|; )scheme=([^;]+)/);var p=m?m[1]:'dark';(p==='auto'?window.matchMedia('(prefers-color-scheme: dark)').matches:(p==='dark'))&&document.documentElement.classList.add('dark');}catch(e){}})();";

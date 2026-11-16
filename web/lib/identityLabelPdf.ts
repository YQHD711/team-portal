/**
 * 身份码 PDF：每人一张工牌二维码，内容 = `{origin}/u/{slug}`（或无 slug 时直接用户名）。
 *
 * 与电池标签（batteryLabelPdf）同一套渲染：复用 lib/labelPdf 的 renderLabelPng/createQrMatrix，
 * 页面尺寸 = 模板尺寸。柜边终端扫身份码 → /api/device/login-by-id 认人。
 */

import type { LabelData, LabelTemplate } from "./labelTemplate";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { buildLabelsPdf, type BuildProgressOptions } from "./printService";

export interface IdentityLabelSource {
  /** 登录名/学号 */
  username: string;
  /** 显示姓名（可空，回落 username） */
  displayName?: string | null;
  /** 公开短标识；为空时身份码内容直接用 username */
  slug?: string | null;
}

/** 身份码内容：有 slug 用短链 /u/{slug}，无 slug 直接用户名（login-by-id 两者都认）。 */
export function identityUrl(u: IdentityLabelSource, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return u.slug ? `${base}/u/${encodeURIComponent(u.slug)}` : u.username;
}

/** 人 → LabelData：编码 = 学号、名称 = 显示姓名、二维码 = 身份码内容。 */
export function toIdentityLabelData(u: IdentityLabelSource, origin: string): LabelData {
  return {
    code: u.username,
    url: identityUrl(u, origin),
    name: u.displayName?.trim() || u.username,
    grade: null,
    locationCode: null,
    category: null,
  };
}

/** 批量生成多页 PDF：每人一张。构建循环统一在 printService（收口），这里只做领域转换。 */
export async function buildIdentityLabelsPdf(
  people: readonly IdentityLabelSource[],
  origin: string,
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: BuildProgressOptions = {},
): Promise<ArrayBuffer> {
  return buildLabelsPdf(people.map(p => toIdentityLabelData(p, origin)), template, opts);
}

/** 身份码文件名：`身份码-YYYY-MM-DD.pdf` */
export function identityLabelFileName(when: Date = new Date()): string {
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `身份码-${d}.pdf`;
}

export { pickMaterialTemplate } from "./printService";

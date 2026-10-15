/**
 * 消息分类（task-24 起**没有白名单**：解码全部 FMT 声明的类型）。
 *
 * 两类特殊消息：
 *  - **声明类**（FMT/FMTU/UNIT/MULT）：只提供"格式 / 单位 / 倍率 / 实例"这些事实，
 *    可能出现在数据之后（本机样本 FMTU 在 36 KB 处），所以必须先整体读一遍再解码数据（两遍扫描）；
 *  - **元信息类**：FMT/FMTU/UNIT/MULT 之外，PARM（参数）与 MSG（横幅/文字）也不作为时序数据看，
 *    但仍会**完整解码**（进 params / meta / events），并计入 decodedFields —— 零静默跳过。
 */

/** 声明类：决定布局与单位，必须先读完。 */
export const DECLARATION_ONLY: ReadonlySet<string> = new Set(["FMT", "FMTU", "UNIT", "MULT"]);

export function isDeclaration(name: string): boolean {
  return DECLARATION_ONLY.has(name);
}

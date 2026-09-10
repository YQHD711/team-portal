/**
 * 库位编码读取辅助。编码格式为四段 `室-元素-层-位`（如 1030-A-3-05），
 * 1×1 整体挂载元素只有 `室-元素` 两段。编码的**构造**统一由 locationOptions.ts
 * 的 composeLocCode 负责（与平面图元素保持一致），此处只做读取。
 */

/** 编码所属房间（第一段）：1030-A-3-05 → 1030 */
export function locationRoom(code?: string): string {
  return (code || "").split("-")[0] || "";
}

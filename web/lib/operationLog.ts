/**
 * 操作日志(OperationLog)的展示辅助：动作中文标签、data 摘要、配色。
 *
 * 抽到 lib 是因为有两个使用方：管理员「操作日志」页 和 队员档案里的
 * 「操作日志」tab。两边必须用同一套话术，否则同一条记录在两处显示成
 * 不同的名字，对不上账。
 */

export interface OperationEntry {
  id: number; userId: number | null; userName: string; action: string;
  targetType: string | null; targetId: string | null; data: string | null;
  ipAddress: string | null; createdAt: string;
}

export interface OperationPage { total: number; items: OperationEntry[]; }

/* 基础动作标签(粗粒度) */
export const baseActionLabels: Record<string, string> = {
  login: "登录", register: "注册", logout: "登出", "change-password": "修改密码",
  checkout: "领用申请", checkin: "归还", "damage-report": "报损", stocktake: "盘点",
  reject: "驳回", approve: "审批", backup: "备份", restore: "恢复",
  import: "导入", create: "创建", update: "修改", delete: "删除",
  settings: "系统设置", invite: "邀请", upload: "上传",
  purchase: "标记已购买", receive: "收货入库", "dept-approve": "部长审批", "admin-approve": "管理员审批",
  profile: "档案", complete: "标记完成", uncomplete: "取消完成",
  // 扫码/手输编码查询物料（/api/inventory/by-code/{code}）：命中与未命中都记一条
  query: "查询",
};

/* 按 (targetType, action) 精化的标签 */
export const targetActionLabel: Record<string, Record<string, string>> = {
  purchase: {
    approve: "采购审批", reject: "拒绝采购", create: "提交采购申请", purchase: "标记已购买",
    receive: "收货入库", update: "采购修改", delete: "删除采购申请",
  },
  material: {
    approve: "领用审批", reject: "驳回领用",
  },
  study: {
    complete: "学完一课", uncomplete: "取消完成",
  },
};

export const targetTypeOptions = [
  { value: "user", label: "用户" }, { value: "department", label: "部门" },
  { value: "material", label: "领用/盘点" }, { value: "purchase", label: "采购" },
  { value: "item", label: "零件" }, { value: "invite-code", label: "邀请码" },
  { value: "knowledge", label: "知识库" }, { value: "document", label: "文档" },
  { value: "settings", label: "系统设置" }, { value: "backup", label: "备份" }, { value: "exam", label: "考核" },
  { value: "study", label: "学习库" },
];

export const actionColors: Record<string, string> = {
  login: "bg-info/15 text-info", register: "bg-info/15 text-info", "change-password": "bg-info/15 text-info",
  create: "bg-success/15 text-success", import: "bg-success/15 text-success", upload: "bg-success/15 text-success",
  update: "bg-primary/15 text-primary", settings: "bg-primary/15 text-primary", purchase: "bg-primary/15 text-primary",
  delete: "bg-danger/15 text-danger", reject: "bg-danger/15 text-danger",
  backup: "bg-primary/15 text-primary", restore: "bg-primary/15 text-primary",
  checkout: "bg-warning/15 text-warning", checkin: "bg-info/15 text-info", "damage-report": "bg-warning/15 text-warning",
  stocktake: "bg-info/15 text-info", invite: "bg-info/15 text-info", "dept-approve": "bg-info/15 text-info",
  "admin-approve": "bg-info/15 text-info", receive: "bg-success/15 text-success", approve: "bg-success/15 text-success",
  complete: "bg-success/15 text-success", uncomplete: "bg-warning/15 text-warning",
  query: "bg-info/15 text-info",
};

/** 动作中文标签: 先按 targetType 精化,否则粗粒度表 */
export function actionLabel(a: string, targetType: string | null): string {
  const refined = targetType ? targetActionLabel[targetType]?.[a] : undefined;
  return refined || baseActionLabels[a] || a;
}

/** 从 data JSON 提炼可读摘要(key: value · ...),忽略嵌套/空值 */
export function summarize(data: string | null): string {
  if (!data) return "";
  try {
    const obj = JSON.parse(data);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v == null || typeof v === "object") continue;
      if (k === "id" || k === "userId" || k === "success") continue;
      parts.push(`${k}: ${String(v)}`);
      if (parts.length >= 6) break;
    }
    return parts.join(" · ");
  } catch { return ""; }
}

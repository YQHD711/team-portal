import type { CopyEntry } from "../types";

/**
 * 侧栏导航与底部版权文案。
 *
 * key 与 Sidebar.tsx 的 href 一一对应（nav.<路由末段>），改文案不改路由。
 * 分组标题（总览/资源/团队/管理/物料管理）同样可配。
 */
export const NAV_COPY: Record<string, CopyEntry> = {
  "nav.group.overview": { text: "总览", group: "导航", desc: "侧栏分组标题", max: 8 },
  "nav.dashboard": { text: "仪表盘", group: "导航", desc: "侧栏 · 总览", max: 10 },

  "nav.group.resources": { text: "资源", group: "导航", desc: "侧栏分组标题", max: 8 },
  "nav.study": { text: "学习库", group: "导航", desc: "侧栏 · 资源", max: 12 },
  "nav.flightlog": { text: "飞行日志 / 固件", group: "导航", desc: "侧栏 · 资源", max: 20 },
  "nav.webtools": { text: "日志分析", group: "导航", desc: "侧栏 · 资源", max: 12 },
  "nav.wiki": { text: "Wiki 文档", group: "导航", desc: "侧栏 · 资源", max: 16 },

  "nav.group.team": { text: "团队", group: "导航", desc: "侧栏分组标题", max: 8 },
  "nav.incidents": { text: "事故安全", group: "导航", desc: "侧栏 · 团队", max: 12 },
  "nav.files": { text: "资源共享", group: "导航", desc: "侧栏 · 团队", max: 12 },
  "nav.profile": { text: "我的档案", group: "导航", desc: "侧栏 · 团队", max: 12 },

  "nav.group.materials": { text: "物料管理", group: "导航", desc: "侧栏可折叠分组标题", max: 12 },
  "nav.inventory": { text: "零件库存", group: "导航", desc: "物料管理子项", max: 12 },
  "nav.layout": { text: "物料布局", group: "导航", desc: "物料管理子项", max: 12 },
  "nav.checkout": { text: "领用管理", group: "导航", desc: "物料管理子项", max: 12 },
  "nav.stocktake": { text: "盘点", group: "导航", desc: "物料管理子项", max: 12 },
  "nav.battery": { text: "电池借还", group: "导航", desc: "物料管理子项", max: 12 },
  "nav.finance": { text: "采购申请", group: "导航", desc: "物料管理子项", max: 12 },

  "nav.group.admin": { text: "管理", group: "导航", desc: "仅 staff 可见的分组标题", max: 8 },
  "nav.knowledge": { text: "知识库", group: "导航", desc: "管理 · 部长与管理员", max: 12 },
  "nav.organization": { text: "组织架构", group: "导航", desc: "管理 · 部长与管理员", max: 12 },
  "nav.exams": { text: "考核管理", group: "导航", desc: "管理 · 部长与管理员", max: 12 },
  "nav.wiki-settings": { text: "Wiki 设置", group: "导航", desc: "管理 · 部长与管理员", max: 16 },
  "nav.settings": { text: "系统设置", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.label-templates": { text: "标签模板", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.logs": { text: "系统日志", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.trash": { text: "回收站", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.backup": { text: "备份恢复", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.cloud": { text: "云存储", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.devices": { text: "设备管理", group: "导航", desc: "管理 · 仅管理员", max: 12 },
  "nav.ai-admin": { text: "AI 管理员", group: "导航", desc: "管理 · 仅管理员", max: 12 },

  "nav.footer": { text: "{teamName} © 2026 · 内部系统", group: "导航", desc: "侧栏底部版权（{teamName} 由品牌设置注入）", max: 40 },
  "nav.menu.open": { text: "打开菜单", group: "导航", desc: "移动端汉堡按钮读屏文案", max: 12 },
};

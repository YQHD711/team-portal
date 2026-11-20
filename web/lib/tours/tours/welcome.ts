import { ALL_ROLES, type TourDef } from "../types";

/**
 * 首次登录的全局引导（替换原 OnboardingCard 的静态卡片）。
 * 只讲"界面在哪"，各功能细节由进入功能页时的独立引导负责。
 */
export const welcomeTour: TourDef = {
  key: "welcome",
  title: "欢迎与全局导航",
  roles: ALL_ROLES,
  entry: "/",
  autoStart: true,
  version: 1,
  steps: [
    {
      id: "nav",
      target: "sidebar-base",
      title: "功能都在左侧",
      body: "导航按「总览 / 资源 / 团队」分组；物料管理可以展开，里面是库存、电池和采购。",
      placement: "right",
      desktopOnly: true,
    },
    {
      id: "search",
      target: "topbar-search",
      title: "全局搜索",
      body: "搜知识库、库存、Wiki 和共享文件。按 Ctrl+K 或直接敲 / 也能唤出。",
      placement: "bottom",
    },
    {
      id: "notify",
      target: "topbar-notify",
      title: "通知",
      body: "借还提醒、审批结果、考核安排都会推到这里，红点表示还没看。",
      placement: "bottom",
    },
    {
      id: "ai",
      target: "ai-fab",
      title: "AI 助手",
      body: "右下角随时提问，能查库存、查文档、汇总日志；回答会标注引用的资料。",
      placement: "top",
    },
    {
      id: "profile",
      target: "nav-profile",
      title: "先完善档案",
      body: "填上真名和学号，队友和借还记录里才认得出你；部长分配部门后能看到部门知识库。",
      placement: "right",
      desktopOnly: true,
      action: { label: "去我的档案", href: "/profile" },
    },
    {
      id: "study",
      target: "nav-study",
      title: "新队员从这里开始",
      body: "学习库有入门课程；考核安排由部长发布，完成进度会记录在你的档案里。",
      placement: "right",
      desktopOnly: true,
      action: { label: "去学习库", href: "/study" },
    },
  ],
};

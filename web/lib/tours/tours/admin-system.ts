import { ADMIN_ROLES, type TourDef } from "../types";

/** 仅管理员：系统设置 / 内容管理 / 日志 / 回收站 / 备份 */
export const adminSystemTours: TourDef[] = [
  {
    key: "settings",
    title: "系统设置",
    roles: ADMIN_ROLES,
    entry: "/admin/settings",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-settings", title: "入口在系统设置",
        body: "「管理 → 系统设置」。品牌、认证、AI 服务、存储参数都在这里，改动立即对全员生效。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-settings", title: "分组配置",
        body: "按「认证安全 / AI 服务 / 百度网盘 / 系统参数」分组；密钥类字段留空表示沿用环境变量，不会回显。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "content",
    title: "内容管理",
    roles: ADMIN_ROLES,
    entry: "/admin/content",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-content", title: "入口在内容管理",
        body: "「管理 → 内容管理」。界面文案与使用引导都能在这里改，不用发版。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-content", title: "文案与引导",
        body: "「界面文案」按分组列出所有可改文字，改坏了点恢复默认；「使用引导」可以改步骤文案、启停或重置整条引导。",
        placement: "bottom", action: { label: "打开内容管理", href: "/admin/content" },
      },
    ],
  },
  {
    key: "logs",
    title: "系统日志",
    roles: ADMIN_ROLES,
    entry: "/admin/logs",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-logs", title: "入口在系统日志",
        body: "「管理 → 系统日志」。出问题先来这里看：请求日志与操作日志分开。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-logs", title: "请求与操作",
        body: "请求日志看接口耗时与状态码，操作日志看谁改了什么；可以按人、按时间筛选后导出。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "trash",
    title: "回收站",
    roles: ADMIN_ROLES,
    entry: "/admin/trash",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-trash", title: "入口在回收站",
        body: "「管理 → 回收站」。误删的文档/物料/文件先来这里找。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-trash", title: "恢复或彻底删除",
        body: "恢复会把内容放回原处；彻底删除不可逆，只在确认没用了再点。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "backup",
    title: "备份恢复",
    roles: ADMIN_ROLES,
    entry: "/admin/backup",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-backup", title: "入口在备份恢复",
        body: "「管理 → 备份恢复」。数据库与设置一起打包，可以下载或同步到云端。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-backup", title: "备份与还原",
        body: "立即备份会生成一份快照；还原前先确认备份时间点，避免把新数据覆盖掉。",
        placement: "bottom",
      },
    ],
  },
];

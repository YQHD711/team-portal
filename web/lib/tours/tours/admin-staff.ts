import { STAFF_ROLES, type TourDef } from "../types";

/** 部长与管理员可见的管理功能 */
export const adminStaffTours: TourDef[] = [
  {
    key: "knowledge",
    title: "知识库管理",
    roles: STAFF_ROLES,
    entry: "/admin/knowledge",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-knowledge", title: "入口在知识库",
        body: "「管理 → 知识库」只有部长与管理员能进，普通成员看到的是只读内容。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-knowledge", title: "目录与文档",
        body: "左侧目录树可以新建文件夹与文档；正文支持 Markdown、图片与 Mermaid 图。改动会留编辑记录，误删可在回收站恢复。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "organization",
    title: "组织架构",
    roles: STAFF_ROLES,
    entry: "/admin/organization",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-organization", title: "入口在组织架构",
        body: "「管理 → 组织架构」。部门、队员、邀请码都在这里维护。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-organization", title: "管人、管部门、发邀请",
        body: "队员卡片可以改部门/角色/学号，也可以一键挂失；邀请码用来放新队员注册，可设有效期并随时作废。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "exams",
    title: "考核管理",
    roles: STAFF_ROLES,
    entry: "/admin/exams",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-exams", title: "入口在考核管理",
        body: "「管理 → 考核管理」。部门考核的发布与成绩录入。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-exams", title: "发布考核与录成绩",
        body: "新建考核时选部门与类型；考完逐人录入成绩和备注，队员在档案页能看到自己的记录。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "wiki-settings",
    title: "Wiki 设置",
    roles: STAFF_ROLES,
    entry: "/admin/wiki-settings",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-wiki-settings", title: "入口在 Wiki 设置",
        body: "「管理 → Wiki 设置」。控制 AI 怎么从代码库生成文档。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-wiki-settings", title: "模型与生成参数",
        body: "可以指定生成用的模型、并发数与超时；改坏了恢复默认即可，不会影响已有文档。",
        placement: "bottom",
      },
    ],
  },
];

import { ALL_ROLES, type TourDef } from "../types";

/** 团队协作类：事故安全 / 资源共享 / 我的档案 */
export const teamTours: TourDef[] = [
  {
    key: "incidents",
    title: "事故安全",
    roles: ALL_ROLES,
    entry: "/incidents",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-incidents", title: "入口在事故安全",
        body: "「团队 → 事故安全」。摔机、炸机、丢件都从这里登记，别只在群里说一声。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-incidents", title: "登记与处理",
        body: "填清时间、机型、经过和损失；部长会处理并定责。登记过的事故会进安全统计，借电池时鼓包等记录也会关联到这里。",
        placement: "bottom", action: { label: "去事故安全", href: "/incidents" },
      },
    ],
  },
  {
    key: "files",
    title: "资源共享",
    roles: ALL_ROLES,
    entry: "/files",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-files", title: "入口在资源共享",
        body: "「团队 → 资源共享」。图纸、说明书、比赛资料都放这里。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-files", title: "上传与下载",
        body: "点右上角上传文件（大文件也支持），按文件名搜索就能下载。删除会进回收站，管理员可恢复。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "profile",
    title: "我的档案",
    roles: ALL_ROLES,
    entry: "/profile",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-profile", title: "入口在我的档案",
        body: "「团队 → 我的档案」。头像菜单里也能进。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-profile", title: "真名、学号与认证",
        body: "填上真名和学号，队友与借还记录才认得出你；训练、认证、竞赛记录都在这里累积。",
        placement: "bottom", action: { label: "去我的档案", href: "/profile" },
      },
    ],
  },
];

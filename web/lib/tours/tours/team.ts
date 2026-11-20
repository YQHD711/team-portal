import { ALL_ROLES, STAFF_ROLES, type TourDef } from "../types";

/** 团队协作类：事故安全 / 资源共享 / 我的档案 */
export const teamTours: TourDef[] = [
  {
    key: "incidents",
    title: "事故安全",
    roles: ALL_ROLES,
    entry: "/incidents",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-incidents", title: "入口在团队 → 事故安全",
        body: "摔机、炸机、电池鼓包、丢件都从这里登记，别只在群里说一声。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-incidents", title: "电池 / 飞行两类记录",
        body: "页面上半部分是电池事故（与借还记录关联），下半部分是飞行事故。",
        placement: "bottom",
      },
      {
        id: "tabs", target: "incidents-tabs", title: "切换记录类型",
        body: "电池事故按电池编号关联台账；飞行事故记录机型、经过与损失，处理结果会写进档案。",
        placement: "bottom",
      },
      {
        id: "actions", target: "incidents-actions", title: "登记新事故（部长/管理员）",
        body: "点「记录电池事故」新建；普通成员发现问题先报给部长，由部长录入并定责。",
        placement: "bottom", roles: STAFF_ROLES,
      },
    ],
  },
  {
    key: "files",
    title: "资源共享",
    roles: ALL_ROLES,
    entry: "/files",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-files", title: "入口在团队 → 资源共享",
        body: "图纸、说明书、比赛资料都放这里，支持任意格式（单文件最大 1GB）。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-files", title: "共享文件",
        body: "按上传时间排列，能看到上传人和大小；文件名相同也不会覆盖，各自保留。",
        placement: "bottom",
      },
      {
        id: "upload", target: "files-upload", title: "上传与可见范围",
        body: "选文件后设可见范围：「公开」全队可见，「部门」只对同部门可见。上传按钮在表单右侧。",
        placement: "bottom", action: { label: "去资源共享", href: "/files" },
      },
      {
        id: "list", target: "files-list", title: "下载与管理",
        body: "点右侧下载按钮取文件（会带登录凭据）；部长可以删除，删除进回收站可恢复。",
        placement: "top",
      },
    ],
  },
  {
    key: "profile",
    title: "我的档案",
    roles: ALL_ROLES,
    entry: "/profile",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-profile", title: "入口在团队 → 我的档案",
        body: "头像菜单里也能进。新队员第一件事：把真名和学号填上。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-profile", title: "你的档案",
        body: "基本信息、培训记录、参赛记录、认证四块；借还记录与考核结果都会回流到这里。",
        placement: "bottom",
      },
      {
        id: "tabs", target: "profile-tabs", title: "四个页签",
        body: "「我的认证」展示考核通过记录；培训与参赛记录由部长录入，自己改不了。",
        placement: "bottom",
      },
      {
        id: "info", target: "profile-info", title: "基本信息可自改",
        body: "真名、学号、紧急联系人可以自己维护；学号是设备免密认人的依据，改错会认不出你。",
        placement: "top", action: { label: "去我的档案", href: "/profile" },
      },
    ],
  },
];

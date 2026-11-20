import { ALL_ROLES, type TourDef } from "../types";

/** 学习与资料类：学习库 / 飞行日志 / 日志分析 / Wiki 文档 */
export const learningTours: TourDef[] = [
  {
    key: "study",
    title: "学习库",
    roles: ALL_ROLES,
    entry: "/study",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-study", title: "入口在学习库",
        body: "「资源 → 学习库」。新队员从这里开始，先看入门筑基的课时。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-study", title: "按部门与阶段浏览",
        body: "课程按部门 / 阶段 / 课时三级组织。课时读完会自动勾选，进度记进你的档案，部长能看部门完成率。",
        placement: "bottom", action: { label: "去学习库", href: "/study" },
      },
    ],
  },
  {
    key: "flightlog",
    title: "飞行日志 / 固件",
    roles: ALL_ROLES,
    entry: "/flightlog",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-flightlog", title: "入口在飞行日志",
        body: "「资源 → 飞行日志 / 固件」。上传 .bin / .tlog，或在这里下载刷机固件。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-flightlog", title: "上传日志做诊断",
        body: "选择日志文件后进入诊断：规则引擎会检查姿态、振动、供电等，逐条给出结论与建议，不用自己翻曲线。",
        placement: "bottom", action: { label: "去飞行日志", href: "/flightlog" },
      },
    ],
  },
  {
    key: "webtools",
    title: "日志分析工具",
    roles: ALL_ROLES,
    entry: "/webtools",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-webtools", title: "入口在日志分析",
        body: "「资源 → 日志分析」。这里放外部分析工具的使用说明与下载（AirspeedFit 等）。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-webtools", title: "工具说明",
        body: "每个工具都有一节：能干什么、怎么装、参数怎么填。看完再去用，比对着英文界面试错省时间。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "wiki",
    title: "Wiki 文档",
    roles: ALL_ROLES,
    entry: "/wiki",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-wiki", title: "入口在 Wiki 文档",
        body: "「资源 → Wiki 文档」。按项目生成的结构化文档，比散落的 Markdown 好找。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-wiki", title: "任务与文档树",
        body: "左侧是任务（每个任务对应一个代码库/项目），展开后是目录树。右上角可以按关键词搜索正文。",
        placement: "bottom",
      },
    ],
  },
];

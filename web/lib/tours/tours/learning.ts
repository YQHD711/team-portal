import { ALL_ROLES, type TourDef } from "../types";

/** 学习与资料类：学习库 / 飞行日志 / 日志分析 / Wiki 文档 */
export const learningTours: TourDef[] = [
  {
    key: "study",
    title: "学习库",
    roles: ALL_ROLES,
    entry: "/study",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-study", title: "入口在资源 → 学习库",
        body: "新队员第一站。内容与知识库同源，按部门 / 阶段 / 课时组织。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-study", title: "学习路径总览",
        body: "这里显示你所在部门的学习路径，以及「已学 x/y」的完成度；切换部门可以看别人的库（只读）。",
        placement: "bottom",
      },
      {
        id: "actions", target: "study-actions", title: "完成情况与编辑",
        body: "部长可以看部门完成率；部长/管理员还能直接跳到知识库编辑当前这一课的内容。",
        placement: "bottom",
      },
      {
        id: "path", target: "study-path", title: "打开课时学习",
        body: "点课时进入阅读页：读到最后可以勾选「已完成」，进度会记进你的档案；上一课/下一课可以连续读。",
        placement: "top", action: { label: "去学习库", href: "/study" },
      },
    ],
  },
  {
    key: "flightlog",
    title: "飞行日志 / 固件",
    roles: ALL_ROLES,
    entry: "/flightlog",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-flightlog", title: "入口在资源 → 飞行日志",
        body: "摔机后先别删日志，来这里诊断；刷机固件也在同一页。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-flightlog", title: "飞行日志 / 固件",
        body: "两个页签：诊断（主要功能）与固件下载。默认打开诊断，避免一进来就拉固件接口。",
        placement: "bottom",
      },
      {
        id: "tabs", target: "flightlog-tabs", title: "切换诊断 / 固件",
        body: "诊断页签里选日志文件即可分析；固件页签按机型/版本/Bootloader 下载 ArduPilot 或 PX4 固件。",
        placement: "bottom",
      },
      {
        id: "content", target: "flightlog-content", title: "诊断面板",
        body: "解析在浏览器本地完成，日志不上传服务器。规则引擎会逐条给出结论（通过/警告/不适用）和建议，不通过的不会写「通过」。",
        placement: "top", action: { label: "去飞行日志", href: "/flightlog" },
      },
    ],
  },
  {
    key: "webtools",
    title: "日志分析工具",
    roles: ALL_ROLES,
    entry: "/webtools",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-webtools", title: "入口在资源 → 日志分析",
        body: "外部工具的使用说明与下载入口，和上面的「飞行日志」不是同一个功能。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-webtools", title: "工具说明",
        body: "每个工具一节：能干什么、怎么装、参数怎么填。看完再去用，比对着英文界面试错省时间。",
        placement: "bottom",
      },
      {
        id: "note", target: "page-webtools", title: "先看说明再操作",
        body: "下载的安装包与命令行参数都在正文里；遇到问题把日志和截图发到群里，方便定位。",
        placement: "top",
      },
    ],
  },
  {
    key: "wiki",
    title: "Wiki 文档",
    roles: ALL_ROLES,
    entry: "/wiki",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-wiki", title: "入口在资源 → Wiki 文档",
        body: "AI 从代码库生成的结构化文档，按项目归档，比散落的 Markdown 好找。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-wiki", title: "已完成的项目文档",
        body: "只展示生成完成的项目；生成中/失败的任务在管理端看。",
        placement: "bottom",
      },
      {
        id: "list", target: "wiki-list", title: "打开项目看目录",
        body: "点卡片进入文档：左侧目录树、右侧正文，右上角能按关键词搜索正文；深链接可以直接发给队友。",
        placement: "top",
      },
    ],
  },
];

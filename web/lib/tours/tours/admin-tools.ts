import { ADMIN_ROLES, type TourDef } from "../types";

/** 仅管理员：标签模板 / 云存储 / 设备 / AI 管理员 */
export const adminToolTours: TourDef[] = [
  {
    key: "label-templates",
    title: "标签模板",
    roles: ADMIN_ROLES,
    entry: "/admin/label-templates",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-label-templates", title: "入口在标签模板",
        body: "「管理 → 标签模板」。物料标签与库位标签的版式，全队共用。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-label-templates", title: "版式与尺寸",
        body: "拖拽元素设计版式，二维码/文字位置可调；改完保存即对所有人生效，打印前先导出一张试印。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "cloud",
    title: "云存储",
    roles: ADMIN_ROLES,
    entry: "/admin/cloud",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-cloud", title: "入口在云存储",
        body: "「管理 → 云存储」。授权百度网盘后，备份与共享文件可以同步到云端。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-cloud", title: "授权与文件",
        body: "先完成授权再操作文件；授权状态过期会在页面上提示，重新扫码即可。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "devices",
    title: "设备管理",
    roles: ADMIN_ROLES,
    entry: "/admin/devices",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-devices", title: "入口在设备管理",
        body: "「管理 → 设备管理」。柜边终端、ESP32 这类设备在这里登记。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-devices", title: "凭据与遥测",
        body: "创建设备会生成一次性密钥（只显示一次）；之后能看它的在线状态与遥测流水，停用后立即失效。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "ai-admin",
    title: "AI 管理员",
    roles: ADMIN_ROLES,
    entry: "/admin/ai-admin",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-ai-admin", title: "入口在 AI 管理员",
        body: "「管理 → AI 管理员」。用对话方式查系统状态，不用记命令。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-ai-admin", title: "只读运维助手",
        body: "它能看日志、查健康状态、给排查建议；不会改代码或重启服务，涉及写操作仍需人来执行。",
        placement: "bottom",
      },
    ],
  },
];

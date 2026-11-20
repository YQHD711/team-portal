import { ALL_ROLES, type TourDef } from "../types";

/** 电池借还：现场"扫码 → 借出 / 归还"的完整动线。 */
export const batteryTour: TourDef = {
  key: "battery",
  title: "电池借还",
  roles: ALL_ROLES,
  entry: "/batteries",
  autoStart: true,
  version: 1,
  steps: [
    {
      id: "entry",
      target: "nav-battery",
      title: "入口在物料管理里",
      body: "「物料管理 → 电池借还」。也可以直接扫电池上的二维码进入。",
      placement: "right",
      desktopOnly: true,
    },
    {
      id: "scan",
      target: "battery-scan",
      title: "扫码或手输编码",
      body: "扫柜前电池上的二维码，或手动输入电池编号。手机端可直接调起相机。",
      placement: "bottom",
    },
    {
      id: "actions",
      target: "battery-actions",
      title: "借出 / 归还",
      body: "空闲电池点「借出」，用完点「归还」。归还前会做一次健康检查，鼓包电池会被拦下。",
      placement: "top",
    },
    {
      id: "active",
      target: "battery-active",
      title: "在借与逾期",
      body: "这里能看到你手上的电池和剩余时间；逾期会推通知提醒，也会进借还流水。",
      placement: "top",
    },
  ],
};

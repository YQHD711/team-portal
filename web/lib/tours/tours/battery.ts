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
      title: "扫码借还",
      body: "点右上角「扫码借还」扫电池上的二维码（也可以手动输入编号）；手机端会直接调起相机。",
      placement: "bottom",
    },
    {
      id: "active",
      target: "battery-active",
      title: "筛选与在借状态",
      body: "按状态筛选电池；页面顶部两张卡汇总「我在借」和「超时未还（全队）」。",
      placement: "top",
    },
    {
      id: "actions",
      target: "battery-actions",
      title: "借出 / 归还",
      body: "点卡片上的「借出」或「归还」。归还前会做一次健康检查，鼓包电池会被拦下。",
      placement: "top",
    },
  ],
};

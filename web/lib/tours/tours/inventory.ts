import { ALL_ROLES, type TourDef } from "../types";

/** 零件库存：查、领、盘三条主线。 */
export const inventoryTour: TourDef = {
  key: "inventory",
  title: "零件库存",
  roles: ALL_ROLES,
  entry: "/inventory",
  autoStart: true,
  version: 1,
  steps: [
    {
      id: "entry",
      target: "nav-inventory",
      title: "库存入口",
      body: "「物料管理 → 零件库存」。物料布局、领用管理、盘点都在同一分组下。",
      placement: "right",
      desktopOnly: true,
    },
    {
      id: "toolbar",
      target: "inventory-toolbar",
      title: "搜索与新增",
      body: "按名称、编码、库位搜索；部长和管理员可以新增物料、批量打印标签。",
      placement: "bottom",
    },
    {
      id: "table",
      target: "inventory-table",
      title: "库存列表",
      body: "点行看详情与流水；库存低于阈值会标黄，仪表盘也会提示。",
      placement: "top",
    },
    {
      id: "checkout",
      target: "nav-checkout",
      title: "领用与归还",
      body: "领用管理里提交申请，部长审批后出库；归还时可在「盘点」里核对数量。",
      placement: "right",
      desktopOnly: true,
    },
  ],
};

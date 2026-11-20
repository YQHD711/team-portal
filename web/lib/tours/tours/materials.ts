import { ALL_ROLES, type TourDef } from "../types";

/** 物料相关（除库存与电池外的四个入口）：领用 / 盘点 / 采购 / 布局 */
export const materialTours: TourDef[] = [
  {
    key: "checkout",
    title: "领用管理",
    roles: ALL_ROLES,
    entry: "/inventory/checkout",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-checkout", title: "入口在领用管理",
        body: "「物料管理 → 领用管理」。从这里提交领用申请，归还也在这里登记。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-checkout", title: "申请与审批",
        body: "选物料、填数量与用途后提交；部长审批后出库。归还时记录设备状态，损坏要写清楚，方便定责。",
        placement: "bottom", action: { label: "去领用管理", href: "/inventory/checkout" },
      },
    ],
  },
  {
    key: "stocktake",
    title: "盘点",
    roles: ALL_ROLES,
    entry: "/inventory/stocktake",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-stocktake", title: "入口在盘点",
        body: "「物料管理 → 盘点」。期末对账就靠它：账上数量与实物是否一致。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-stocktake", title: "建任务、逐项核对",
        body: "新建盘点任务后逐项填实盘数量，差异会自动标出；提交后库存按实盘数修正，流水里能看到是谁盘的。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "finance",
    title: "采购申请",
    roles: ALL_ROLES,
    entry: "/finance",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-finance", title: "入口在采购申请",
        body: "「物料管理 → 采购申请」。缺件要买时先提申请，别先买后补。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-finance", title: "申请与审批",
        body: "填品名、数量、预估价格和用途；部长与管理员审批后进入采购，到货登记后库存同步增加。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "layout",
    title: "物料布局",
    roles: ALL_ROLES,
    entry: "/inventory/layout",
    autoStart: true,
    version: 1,
    steps: [
      {
        id: "entry", target: "nav-layout", title: "入口在物料布局",
        body: "「物料管理 → 物料布局」。想找东西在哪个柜子，先看这张图。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-layout", title: "房间与库位",
        body: "每张图对应一个房间：货架、柜子、桌子按实际位置摆放；点库位能看到里面放了哪些物料。",
        placement: "bottom",
      },
    ],
  },
];

import { ALL_ROLES, type TourDef } from "../types";

/** 物料相关（除库存与电池外的四个入口）：领用 / 盘点 / 采购 / 布局 */
export const materialTours: TourDef[] = [
  {
    key: "checkout",
    title: "领用管理",
    roles: ALL_ROLES,
    entry: "/inventory/checkout",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-checkout", title: "入口在物料管理 → 领用管理",
        body: "从这里提交领用申请，归还也在这里登记。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-checkout", title: "领用管理",
        body: "顶部能返回库存；下面分「我的领用 / 待审批 / 借出中」三个视角。",
        placement: "bottom",
      },
      {
        id: "new", target: "checkout-new", title: "提交领用申请",
        body: "选物料、填数量与用途；部长审批后出库。归还时记录设备状态，损坏要写清楚方便定责。",
        placement: "bottom", action: { label: "去领用管理", href: "/inventory/checkout" },
      },
      {
        id: "tabs", target: "checkout-tabs", title: "审批与借出中",
        body: "部长在「待审批」处理申请；「借出中」看谁还没还，逾期会提醒。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "stocktake",
    title: "盘点",
    roles: ALL_ROLES,
    entry: "/inventory/stocktake",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-stocktake", title: "入口在物料管理 → 盘点",
        body: "期末对账靠它：账上数量与实物是否一致，差异自动标出。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-stocktake", title: "盘点任务",
        body: "发起人把任务分派给队员，逐项填实盘数量；提交后库存按实盘数修正。",
        placement: "bottom",
      },
      {
        id: "tabs", target: "stocktake-tabs", title: "我的任务 / 全部盘点",
        body: "「我的任务」是你被分到的项；「全部盘点」（部长）看历史与差异明细。",
        placement: "bottom", action: { label: "去盘点", href: "/inventory/stocktake" },
      },
    ],
  },
  {
    key: "finance",
    title: "采购申请",
    roles: ALL_ROLES,
    entry: "/finance",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-finance", title: "入口在物料管理 → 采购申请",
        body: "缺件要买时先提申请，别先买后补。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-finance", title: "采购申请",
        body: "如果你有审批权限，顶部还会看到待审批、已购买、已入库与总支出的统计卡。",
        placement: "bottom",
      },
      {
        id: "new", target: "finance-new", title: "提交申请",
        body: "填品名、数量、预估价格与用途；审批流程：部长 → 管理员，之后是购买、到货入库。",
        placement: "bottom", action: { label: "去采购申请", href: "/finance" },
      },
      {
        id: "list", target: "finance-list", title: "申请列表",
        body: "每条申请显示当前状态与审批人；删除会进回收站，可在「回收站」恢复。",
        placement: "top",
      },
    ],
  },
  {
    key: "layout",
    title: "物料布局",
    roles: ALL_ROLES,
    entry: "/inventory/layout",
    autoStart: true,
    version: 2,
    steps: [
      {
        id: "entry", target: "nav-layout", title: "入口在物料管理 → 物料布局",
        body: "想找东西在哪个柜子，先看这张图。",
        placement: "right", desktopOnly: true,
      },
      {
        id: "page", target: "page-layout", title: "楼层概览",
        body: "每个房间一张卡片，标了房间号、楼层和里面的物料数量。",
        placement: "bottom",
      },
      {
        id: "rooms", target: "layout-rooms", title: "打开房间看平面图",
        body: "点房间进入平面图：货架/柜子/桌子按实际位置摆放，点库位能看到里面放了哪些物料；部长可以点「编辑平面图」调整。",
        placement: "top", action: { label: "去物料布局", href: "/inventory/layout" },
      },
    ],
  },
];

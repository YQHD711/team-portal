/* 库存管理共享类型与常量（inventory 页面及其子组件共用） */

export interface InventoryItem { id: number; name: string; category: string; quantity: number; code?: string; locationCode?: string; status: string; grade: string; unitPrice: number; departmentId?: number; department?: { id: number; name: string }; updatedAt: string; photoUrl?: string; }
export interface Department { id: number; name: string; }
export interface Transaction { id: number; type: string; quantity: number; userName: string; note: string | null; createdAt: string; }
/** 零件表单状态（新建/编辑共用） */
export interface InventoryFormState {
  name: string; category: string; quantity: number; grade: string; unitPrice: number;
  departmentId: number; locationCode: string;
  /** 最终物料编码：可自动生成，也可直接手填 */
  code: string;
  /** 自动生号用的三段（物品号/型号/年份）——系统只负责拼前缀、年份、序号 */
  codeItemNo: string; codeModel: string; codeYear: string;
}

/** 新建表单的初始值 */
export const emptyInventoryForm = (): InventoryFormState => ({
  name: "", category: "", quantity: 0, grade: "C", unitPrice: 0, departmentId: 0,
  locationCode: "", code: "", codeItemNo: "", codeModel: "",
  codeYear: String(new Date().getFullYear()),
});

/** 低库存阈值兜底值：真实取值由后端设置下发（GET /api/inventory/meta），见 LowStockProvider */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const statusOpts = [
  { value: "available", label: "可用" },
  { value: "in_use", label: "使用中" },
  { value: "broken", label: "损坏" },
];
export const categoryOpts = ["电子元器件", "结构材料", "工具设备", "耗材", "动力系统", "飞控系统", "通信设备", "电池电源", "其他"];

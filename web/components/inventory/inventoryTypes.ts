/* 库存管理共享类型与常量（inventory 页面及其子组件共用） */

export interface InventoryItem { id: number; name: string; category: string; quantity: number; locationCode?: string; status: string; grade: string; unitPrice: number; departmentId?: number; department?: { id: number; name: string }; projectTag?: string; updatedAt: string; photoUrl?: string; }
export interface Department { id: number; name: string; }
export interface Transaction { id: number; type: string; quantity: number; userName: string; note: string | null; createdAt: string; }
/** 零件表单状态（新建/编辑共用） */
export interface InventoryFormState { name: string; category: string; quantity: number; grade: string; unitPrice: number; departmentId: number; projectTag: string; locationCode: string; }

export const LOW_THRESHOLD = 3;
export const statusOpts = [
  { value: "available", label: "可用" },
  { value: "in_use", label: "使用中" },
  { value: "broken", label: "损坏" },
];
export const categoryOpts = ["电子元器件", "结构材料", "工具设备", "耗材", "动力系统", "飞控系统", "通信设备", "电池电源", "其他"];

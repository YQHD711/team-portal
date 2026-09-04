/* 领用管理共享类型与常量（checkout 页面及其子组件共用） */

export interface Item { id: number; name: string; grade: string; quantity: number; category: string; locationCode?: string; }
export interface CheckoutReq {
  id: number; inventoryItemId: number; quantity: number; grade: string;
  status: string; note?: string; rejectReason?: string;
  createdAt: string; approvedAt?: string; returnedAt?: string;
  item?: Item;
  requester?: { id: number; username: string; department?: { name: string } };
  deptApprover?: { username: string }; adminApprover?: { username: string };
  checkin?: { condition: string; hasPhoto: boolean; testNotes?: string; photoUrl?: string; createdAt: string };
}

export const statusLabels: Record<string, string> = {
  pending_dept: "待部长审批", pending_admin: "待管理员审批",
  approved: "已批准", rejected: "已驳回", returned: "已归还",
};

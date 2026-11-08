/** 电池台账/借还的前端类型与展示映射（与后端 BatteryItem/BatteryLoan 对齐）。 */

export interface BatteryBorrower {
  id: number;
  username: string;
}

export interface BatteryItem {
  id: number;
  code: string;
  model: string | null;
  status: string;
  health: string | null;
  currentBorrowerId: number | null;
  currentBorrower: BatteryBorrower | null;
  borrowedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatteryLoan {
  id: number;
  batteryId: number;
  battery: BatteryItem | null;
  userId: number;
  user: BatteryBorrower | null;
  borrowedAt: string;
  returnedAt: string | null;
  returnedByUserId: number | null;
  note: string | null;
}

const STATUS_META: Record<string, { text: string; cls: string }> = {
  in_stock: { text: "在库", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  borrowed: { text: "借出", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400" },
  charging: { text: "充电中", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  repair: { text: "维修中", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" },
  retired: { text: "已退役", cls: "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { text: status, cls: "bg-zinc-100 text-muted dark:bg-zinc-800 dark:text-faint" };
}

/** 借出超过该小时数视为超时（与后端设置项 Battery:OverdueHours 默认值一致，前端仅用于高亮）。 */
export const OVERDUE_HOURS = 24;

export function isOverdue(b: BatteryItem): boolean {
  if (b.status !== "borrowed" || !b.borrowedAt) return false;
  return Date.now() - new Date(b.borrowedAt).getTime() > OVERDUE_HOURS * 3600_000;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

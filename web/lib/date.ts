/**
 * 本地日期工具。
 *
 * 为什么不用 toISOString().slice(0,10)：它取的是 **UTC 日期**，北京时间 0:00–8:00
 * 填表默认日期会比实际早一天（事故/考核日期记成前一天）。日期字段用**本地日期**。
 */

/** 今天的本地日期：yyyy-MM-dd */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

/** DateTime → 本地日期字符串（展示/表单回填；空值返回空串） */
export function toLocalDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : todayLocal(d);
}

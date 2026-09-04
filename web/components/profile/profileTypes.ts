/* 队员档案详情页共享类型与常量（profiles/[userId] 页面及其子组件共用） */

export interface FullProfile {
  id: number; userId: number; username: string; role: string; department: string | null; departmentId: number | null;
  level: string; totalFlightHours: number; firstFlightDate: string | null;
  bio: string | null; emergencyContact: string | null; emergencyPhone: string | null; flightTypes: string | null; skills: string | null; updatedAt: string;
  trainingRecords: TrainingRecord[]; competitionRecords: CompetitionRecord[];
}
export interface TrainingRecord { id: number; courseName: string; score: number | null; examDate: string; examiner: string | null; notes: string | null; createdAt: string; }
export interface CompetitionRecord { id: number; competitionName: string; date: string; event: string | null; ranking: string | null; certificate: string | null; notes: string | null; createdAt: string; }

export const LEVELS = ["学员", "初级", "中级", "高级", "教练"];
export const FLIGHT_TYPES = ["固定翼", "多旋翼", "穿越机", "凤凰飞行器", "龙飞行器", "直升机", "其他"];
export const LEVEL_COLORS: Record<string, string> = {
  "学员": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "初级": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "中级": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "高级": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "教练": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

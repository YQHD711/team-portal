export interface Dept { id: number; name: string; description: string; createdAt: string; }

export interface OrgUser {
  id: number; username: string; role: string;
  /** 显示姓名（用户自改），为空回落 username */
  displayName?: string | null;
  /** 学号（设备终端认人用），可空 */
  studentId?: string | null;
  department: string | null; departmentId: number | null; createdAt: string;
}

export interface ProfileBrief {
  id: number; userId: number; username: string;
  /** 公开 URL 标识：档案页链接用 /admin/profiles/{slug}（不用自增 ID） */
  slug: string | null;
  department: string | null; skills: string | null;
}

export interface Certification {
  id: number; userId: number; username: string;
  certName: string; level: string; status: string;
  certDate: string | null; notes: string | null;
}

export interface ExamBrief {
  id: number; departmentId: number; title: string;
  examType: string; status: string; examDate: string | null;
}

export interface ExamPass {
  id: number; userId: number; username: string;
  examId: number; examTitle: string;
  examType: string; examDate: string | null;
  score: number | null; notes: string | null;
}

export interface Dept { id: number; name: string; description: string; createdAt: string; }

export interface OrgUser {
  id: number; username: string; role: string;
  department: string | null; departmentId: number | null; createdAt: string;
}

export interface ProfileBrief {
  id: number; userId: number; username: string;
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

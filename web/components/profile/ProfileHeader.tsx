import { LEVEL_COLORS, type FullProfile } from "./profileTypes";

interface Props {
  profile: FullProfile;
}

/** 队员档案头部（头像 + 用户名 + 部门 + 等级徽章） */
export default function ProfileHeader({ profile }: Props) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xl font-bold shadow-lg">
        {profile.username[0]?.toUpperCase() || "?"}
      </div>
      <div>
        <h1 className="text-2xl font-bold">{profile.username}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted">
          <span>{profile.department || "未分配部门"}</span>
          <span>·</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[profile.level]}`}>{profile.level}</span>
        </div>
      </div>
    </div>
  );
}

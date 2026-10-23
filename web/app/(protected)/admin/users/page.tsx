import { redirect } from "next/navigation";

/**
 * 队员管理与邀请码管理都已并入「组织架构」页（/admin/organization 的 OrgTab + InvitesTab），
 * 这里原本是重复的第二套实现（旧接口类型、过期码仍显示作废按钮）。
 * 保留路由只做重定向，避免打断已有书签与 /admin/users 的直达链接。
 */
export default function AdminUsersRedirect() {
  redirect("/admin/organization");
}

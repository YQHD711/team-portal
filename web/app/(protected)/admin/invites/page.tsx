import { redirect } from "next/navigation";

/**
 * 邀请码已并入「组织架构」的页签（组织架构页原本就有 InvitesTab，这里是重复的第二个实现），
 * 保留路由只做重定向，避免打断已有书签。
 */
export default function AdminInvitesRedirect() {
  redirect("/admin/organization");
}

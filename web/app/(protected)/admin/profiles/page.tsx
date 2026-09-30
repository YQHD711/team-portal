import { redirect } from "next/navigation";

/**
 * 队员档案已并入「组织架构」的页签，这里只做重定向。
 * 保留这个路由是为了不打断已有的书签，以及档案详情页的「返回队员列表」按钮。
 */
export default function AdminProfilesRedirect() {
  redirect("/admin/organization");
}

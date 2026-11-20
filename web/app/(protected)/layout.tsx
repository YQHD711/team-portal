import { SidebarProvider } from "@/components/layout/SidebarContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { FloatingChat } from "@/components/ai/FloatingChat";
import { LowStockProvider } from "@/components/inventory/LowStockProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { PermissionsProvider } from "@/components/permissions/PermissionsProvider";

// (protected) 组下的页面都需要登录态,SSR 预渲染无意义(拿不到 cookie);
// 同时规避 client-only 库 (dompurify 等) 在 SSR chunk 里执行报错。
export const dynamic = "force-dynamic";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      {/* 权限集合：侧栏与页面按钮按它渲染（后端仍会校验，前端隐藏不是安全边界） */}
      <PermissionsProvider>
      {/* 引导运行时包住整个受保护区域：自动触发与遮罩都在这一层 */}
      <TourProvider>
        <LowStockProvider>
          <SidebarProvider>
            <div className="flex min-h-full">
              <Sidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <Topbar />
                <main className="flex-1 p-2 sm:p-4 lg:p-6 pb-16 sm:pb-20">{children}</main>
              </div>
            </div>
            <FloatingChat />
          </SidebarProvider>
        </LowStockProvider>
      </TourProvider>
      </PermissionsProvider>
    </AuthGuard>
  );
}

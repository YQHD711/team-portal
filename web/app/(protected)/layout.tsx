import { SidebarProvider } from "@/components/layout/SidebarContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { FloatingChat } from "@/components/ai/FloatingChat";

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
    </AuthGuard>
  );
}

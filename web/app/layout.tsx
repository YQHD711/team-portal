import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BrandProvider } from "@/lib/brand";

// 注意：metadata 是构建期静态导出，无法读取运行时数据库中的品牌配置，SEO 保持默认品牌文案；
// 页面内的品牌文案由 BrandProvider 在客户端从 /api/public/brand 动态获取。
export const metadata: Metadata = {
  title: "雏鹰之翼 · 航模队管理系统",
  description: "雏鹰之翼航模队 — 知识库、零件库存、飞行日志管理与AI助手",
  icons: { icon: "/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased touch-manipulation dark"
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground font-sans">
        <BrandProvider>{children}</BrandProvider>
      </body>
    </html>
  );
}
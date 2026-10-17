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
  // 刻意不设 maximumScale / userScalable：那会禁掉双指缩放，
  // 对视力和手部精细度不佳的队员不友好（WCAG 1.4.4 要求允许放大到 200%）。
};

/** 服务端取品牌主色（失败一律降级，绝不让站点 500）：内部服务到服务调用，不是 SSR 请求自己 */
async function fetchBrandPrimaryColor(): Promise<string | null> {
  try {
    const base = process.env.API_PROXY_URL || "http://localhost:8080";
    const res = await fetch(`${base}/api/public/brand`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { primaryColor?: string | null };
    return data?.primaryColor?.trim() || null;
  } catch {
    return null;   // 后端不可用/超时 → 随主题
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const primaryColor = await fetchBrandPrimaryColor();
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased touch-manipulation dark"
      suppressHydrationWarning
      // 品牌主色由**服务端渲染**（React 管理 → 不会被客户端 patch 抹掉；刷新后仍生效、全员生效）
      style={primaryColor ? ({ "--primary": primaryColor, "--accent": primaryColor } as React.CSSProperties) : undefined}
    >
      <body className="min-h-full bg-background text-foreground font-sans">
        <BrandProvider>{children}</BrandProvider>
      </body>
    </html>
  );
}
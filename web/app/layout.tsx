import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { BrandProvider } from "@/lib/brand";
import { AUTO_SCHEME_SNIPPET, parseScheme, serverDarkClass } from "@/lib/scheme";

// 注意：metadata 是构建期静态导出，无法读取运行时数据库中的品牌配置，SEO 保持默认品牌文案；
// 页面内的品牌文案由 BrandProvider 在客户端从 /api/public/brand 动态获取。
export const metadata: Metadata = {
  title: "雏鹰之翼 · 航模队管理系统",
  description: "雏鹰之翼航模队 — 知识库、零件库存、飞行日志管理与AI助手",
  icons: { icon: "/logo.png" },
  // iOS "添加到主屏幕" 后的标题与状态栏；其余平台忽略这些字段
  appleWebApp: { capable: true, title: "航模队系统", statusBarStyle: "default" },
  // 关闭手机号/地址自动识别：否则 iOS 会把库位编码、库存数量渲染成可点击的电话链接
  formatDetection: { telephone: false, address: false, email: false, date: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 移动端浏览器 UI（地址栏/状态栏）跟随明暗主题
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
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
  // 成员级明暗：cookie 决定首帧 class（服务端渲染 → 不闪；auto 由内联脚本按系统补）
  const schemePref = parseScheme((await cookies()).get("scheme")?.value);
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased touch-manipulation${serverDarkClass(schemePref)}`}
      suppressHydrationWarning
      // 品牌主色由**服务端渲染**（React 管理 → 不会被客户端 patch 抹掉；刷新后仍生效、全员生效）
      style={primaryColor ? ({ "--primary": primaryColor, "--accent": primaryColor } as React.CSSProperties) : undefined}
    >
      <head><script dangerouslySetInnerHTML={{ __html: AUTO_SCHEME_SNIPPET }} /></head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <BrandProvider>{children}</BrandProvider>
      </body>
    </html>
  );
}
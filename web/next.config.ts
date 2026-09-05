import type { NextConfig } from "next";

// Server-side env only (rewrites never reach the browser) — non-NEXT_PUBLIC_ to keep it out of the client bundle.
const apiUrl = process.env.API_PROXY_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js 16 dev 模式跨域保护:把允许的 IP/域名加到这里;通过 build-arg ALLOWED_DEV_ORIGINS 注入(逗号分隔)
  allowedDevOrigins: [
    "192.168.1.10",
    "localhost",
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean) || []),
  ],
  experimental: {
    // 大文件上传(multipart)走 /api rewrites 时需要放宽 body size
    // 默认 proxyClientMaxBodySize=10MB + serverActions 默认 1MB 都会 reset 超过限制的连接
    // 与后端 Kestrel MaxRequestBodySize / Settings Files:MaxUploadMB 三处同步(均 1GB)
    proxyClientMaxBodySize: "1gb",
    serverActions: {
      bodySizeLimit: "1gb",
    },
  },
  // 关闭尾斜杠重定向：WebTools 代理需要保留 /webtools/xxx/ 的尾斜杠
  // （否则页面内 ../modules 相对路径解析错误，且 301 重定向会与 Next 的 308 循环）
  skipTrailingSlashRedirect: true,
  // 全局安全头。CSP 需兼容 mermaid/react-syntax-highlighter/Next 内联脚本，
  // 故 script/style 放宽到 unsafe-inline；ws: 供 dev HMR websocket。
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' ws: wss:",
              "frame-src 'self'",
              "worker-src 'self' blob:",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          // HSTS 仅生产(https 环境)下发；http 开发环境浏览器不处理该头，无副作用
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      // WebTools 静态站同源内嵌：/webtools/* 转发到后端代理（:8080），
      // 否则 iframe 命中 React 页面本身，且跨源 iframe 会拦截 File System Access API
      {
        source: "/webtools/:path*",
        destination: `${apiUrl}/webtools/:path*`,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// Server-side env only (rewrites never reach the browser) — non-NEXT_PUBLIC_ to keep it out of the client bundle.
const apiUrl = process.env.API_PROXY_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.1.10"],
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

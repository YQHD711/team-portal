"use client";

import { useEffect, useState } from "react";
import { wechat } from "@/lib/api";

interface Props {
  /** 后端开关是否启用（false 时不渲染） */
  enabled?: boolean;
  className?: string;
}

/** 微信登录按钮：微信公众号菜单入口的网页端补充。点击走原生跳转（非 ajax）。 */
export function WeChatLoginButton({ enabled, className }: Props) {
  const [href, setHref] = useState<string | null>(null);
  const [show, setShow] = useState(Boolean(enabled));

  useEffect(() => {
    // enabled 未显式传入（父组件只给了开关探测结果）时自行探测
    if (enabled === undefined) {
      wechat
        .config()
        .then((cfg) => {
          setShow(cfg.enabled && Boolean(cfg.authUrl));
          setHref(cfg.authUrl);
        })
        .catch(() => setShow(false));
    } else {
      setShow(enabled);
      if (enabled) wechat.config().then((cfg) => setHref(cfg.authUrl)).catch(() => {});
    }
  }, [enabled]);

  if (!show || !href) return null;

  return (
    <a
      href={href}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors ${className ?? ""}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#07C160]" aria-hidden>
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.367-1.885.164-3.858 1.551-5.263C11.829 6.563 10.414 2.188 8.691 2.188Zm-2.61 3.421a.858.858 0 1 1 0 1.716.858.858 0 0 1 0-1.716Zm5.05 1.716a.858.858 0 1 1 0-1.716.858.858 0 0 1 0 1.716Z" />
        <path d="M24 14.422c0-3.462-3.215-6.269-7.177-6.269-3.897 0-7.178 2.807-7.178 6.27 0 3.461 3.281 6.268 7.178 6.268a8.265 8.265 0 0 0 2.595-.414.618.618 0 0 1 .53.072l1.583.927a.274.274 0 0 0 .236.049.236.236 0 0 0 .172-.229.93.93 0 0 0-.035-.168l-.33-1.253a.464.464 0 0 1 .17-.513C22.6 18.508 24 16.59 24 14.422Zm-8.957-3.144a.711.711 0 1 1 0 1.422.711.711 0 0 1 0-1.422Zm3.62 1.422a.711.711 0 1 1 0-1.422.711.711 0 0 1 0 1.422Z" />
      </svg>
      微信登录
    </a>
  );
}
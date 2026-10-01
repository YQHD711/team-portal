"use client";

/**
 * 可点击的库位：点一下跳到物料布局页并高亮该物料。
 * 所有显示库位的地方都用它，保证跳转参数（room/element/item）只有一份构造逻辑。
 */
import Link from "next/link";
import { MapPin } from "lucide-react";
import { layoutHrefForLocation } from "@/lib/inventoryLayoutLink";
import { locationRoom } from "./locCode";

interface Props {
  /** 库位编码，如 1012-A-3-05；空值表示未指定库位 */
  locationCode?: string | null;
  /** 物料标识（id 或 code），用于进入布局后高亮这件物料 */
  item?: string | number;
  /** 未指定库位时的占位文案 */
  fallback?: string;
  /** 是否显示定位图标 */
  withIcon?: boolean;
  className?: string;
  testId?: string;
}

/** 有库位 → 链接到 `/inventory/layout?room=&element=&item=`；无库位 → 纯文本占位 */
export default function LocationLink({
  locationCode, item, fallback = "—", withIcon = false, className = "", testId,
}: Props) {
  const code = (locationCode || "").trim();
  if (!code) return <span className={className} data-testid={testId ? `${testId}-empty` : undefined}>{fallback}</span>;

  const room = locationRoom(code);
  const element = code.split("-").slice(0, 2).join("-");
  return (
    <Link href={layoutHrefForLocation({ room, element, item })} data-testid={testId}
      title={`在物料布局中查看 ${code}`}
      className={`inline-flex max-w-full items-center gap-0.5 truncate underline-offset-2 hover:text-sky-600 hover:underline ${className}`}>
      {withIcon && <MapPin className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate font-mono">{code}</span>
    </Link>
  );
}

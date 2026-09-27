export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 必须是「全屏容器」：auth 页面里那些背景装饰都是 absolute inset-0，
  // 它们铺的是**这个节点**的范围。以前这里是 flex 居中但没给子节点 w-full，
  // 子节点作为 flex item 只会缩到卡片宽度（~384px），于是渐变背景只铺成中间一条竖带，
  // 大屏上两边留出大片纯色 —— 看着像半成品。
  return (
    <div className="flex min-h-svh w-full items-center justify-center">
      {children}
    </div>
  );
}

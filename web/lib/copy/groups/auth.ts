import type { CopyEntry } from "../types";

/**
 * 登录 / 注册页文案。
 *
 * 注意：这部分用户未登录就要显示，所以文案接口必须允许匿名读取；
 * 接口只返回展示文本，不涉及任何敏感数据。
 */
export const AUTH_COPY: Record<string, CopyEntry> = {
  "auth.tagline": { text: "队员协作 · 知识共享 · 飞行分析", group: "登录注册", desc: "登录页副标题", max: 30 },
  "auth.username": { text: "用户名", group: "登录注册", desc: "用户名标签", max: 10 },
  "auth.username.placeholder": { text: "请输入用户名", group: "登录注册", desc: "用户名输入框占位", max: 20 },
  "auth.password": { text: "密码", group: "登录注册", desc: "密码标签", max: 10 },
  "auth.password.placeholder": { text: "请输入密码", group: "登录注册", desc: "密码输入框占位", max: 20 },
  "auth.submit": { text: "登录", group: "登录注册", desc: "登录按钮", max: 8 },
  "auth.submitting": { text: "登录中…", group: "登录注册", desc: "登录请求进行中", max: 12 },
  "auth.failed": { text: "登录失败", group: "登录注册", desc: "未拿到具体错误时的兜底提示", max: 20 },
  "auth.no-account": { text: "还没有账号？", group: "登录注册", desc: "登录页底部提问", max: 20 },
  "auth.register": { text: "立即注册", group: "登录注册", desc: "跳转注册页链接", max: 12 },
  "auth.forgot": { text: "忘记密码？联系部长或管理员在「组织架构 → 编辑队员」重置", group: "登录注册", desc: "忘记密码指引", max: 60 },
};

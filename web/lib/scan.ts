/**
 * 扫码结果 → 物料编码。
 *
 * 我们印在实物上的二维码内容是短链 `{origin}/i/{编码}`（规范 §6.3），
 * 但也可能有别的来源：别处打印的裸编码、粘贴进来的整条 URL、扫码枪吐出的文本。
 * 这里统一收口，避免每个调用方各写一份解析。
 */
export function extractCodeFromScan(text: string): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  // 短链里 /i/ 后面那一段就是编码；没有 /i/ 就当作裸编码
  const m = raw.match(/\/i\/([^/?#\s]+)/i);
  const code = m ? m[1] : raw;
  try {
    return decodeURIComponent(code).trim().toUpperCase();
  } catch {
    // 非法的 % 转义等：退回原文，交给后端去判有没有
    return code.trim().toUpperCase();
  }
}

/**
 * 当前环境能否调用摄像头。
 *
 * 浏览器只在**安全上下文**（HTTPS 或 localhost）暴露 navigator.mediaDevices，
 * 部署在纯 HTTP 的裸 IP 上时它是 undefined —— 此时必须明确告诉用户为什么，
 * 而不是让他点了按钮没反应。
 */
export function canUseCamera(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

/** 摄像头不可用时的原因说明（直接展示给用户） */
export function cameraUnavailableReason(): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "当前不是 HTTPS 访问，浏览器禁止网页调用摄像头。请用手机相机直接扫二维码，或用扫码枪/手动输入编码。";
  }
  return "当前浏览器不支持调用摄像头。请用手机相机直接扫二维码，或用扫码枪/手动输入编码。";
}

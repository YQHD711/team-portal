/** 复制文本到剪贴板。navigator.clipboard 仅在 HTTPS/localhost（安全上下文）下可用，
 *  纯 HTTP 明文环境（如 http://IP:3000）会不可用，此时回退到 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 回退到下面的 execCommand 路径 */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}
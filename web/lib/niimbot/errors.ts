/**
 * 精臣打印服务错误码 → 人话。
 *
 * 错误码来源：
 *  - web-4.2.1_20260902/pc-react/src/Print.ts 的 printErrorMessage（打印任务错误）
 *  - Demo/js/app/client.js 的 PRINT_JOB_ERRORS / ERROR_CODE_MESSAGES（通信与任务错误）
 * 两处有重叠，这里合并成一个表，文案按本项目用户（航模队队员/管理员）重写。
 */

export type NiimbotStage =
  | "service" | "discover" | "connect" | "initSdk" | "draw"
  | "preview" | "startJob" | "commitJob" | "endJob" | "print";

/** 带阶段/错误码/恢复建议的错误，UI 直接展示 message + recovery */
export class NiimbotError extends Error {
  readonly stage: NiimbotStage;
  readonly errorCode?: number;
  readonly recovery?: string;

  constructor(stage: NiimbotStage, message: string, options: { errorCode?: number; recovery?: string } = {}) {
    super(message);
    this.name = "NiimbotError";
    this.stage = stage;
    this.errorCode = options.errorCode;
    this.recovery = options.recovery;
  }
}

/** 任务错误码 → [原因, 处理建议] */
const JOB_ERRORS: Record<number, [string, string | undefined]> = {
  1: ["打印机上盖没关好", "请合上上盖后再打印"],
  2: ["没检测到标签纸", "请装好标签纸并确认纸路正确"],
  3: ["电量过低", "请给打印机充电后再试"],
  4: ["电池异常", "请联系售后"],
  5: ["打印已被停止", undefined],
  6: ["打印异常", "请稍后重试"],
  7: ["打印头温度过高", "请等打印头冷却后再试"],
  8: ["出纸异常或标签纸用完", "请检查标签纸安装与出纸路径"],
  9: ["打印机正忙", "请等当前任务结束后再试"],
  10: ["未检测到打印头", "请联系售后"],
  11: ["环境温度过低", "请在室温下使用"],
  12: ["打印头未锁紧", "请锁紧打印头"],
  13: ["没检测到碳带", "K3W 用热敏纸，不需要碳带；请确认机型/耗材匹配"],
  14: ["碳带不匹配", "请更换匹配的碳带"],
  15: ["碳带用完", "请更换碳带"],
  16: ["纸张类型错误", "请检查标签纸类型（K3W 支持间隙纸/黑标纸/透明纸）"],
  20: ["标签损坏或不是 RFID 标签", "请换正品标签纸"],
  22: ["与打印服务通讯超时/异常", "请确认打印服务在运行、USB 线连接稳定后重试"],
  23: ["打印机连接已断开", "请重新连接打印机（拔插 USB 或重新上电）"],
  28: ["标签纸异常", "请按打印机右键重新定位标签"],
  30: ["浓度设置异常", "K3W 浓度取值 1~5，请重新设置"],
  31: ["打印模式异常", "K3W 只支持热敏模式（printMode=1）"],
  32: ["标签材质设置异常", "请重新设置标签类型"],
  33: ["不支持该标签材质", "请更换标签纸或改选支持的纸张类型"],
  34: ["不支持 RFID 写入", "请换普通标签纸"],
  50: ["非法标签", "请使用正品标签纸"],
  51: ["非法碳带和标签", "请使用匹配的碳带与标签"],
};

/**
 * 连接本机打印服务失败的提示。
 * 必须把三种原因都讲清楚（服务没装、浏览器本地网络权限、其他拦截），
 * 并给仍能出纸的替代方案 —— 不要假设 ws:// 一定连得上。
 */
export function serviceUnavailableError(loopbackOptionAccepted: boolean): NiimbotError {
  const permissionHint = loopbackOptionAccepted
    ? "浏览器本地设备权限被拒绝：若刚才弹出过「访问本地设备 / 本地网络」提示，请选择允许；拒绝后可在地址栏左侧站点设置里重新授权，再点连接。"
    : "浏览器不支持本机回环权限协商（需 Chrome/Edge 154+）：当前浏览器可能把 HTTPS 页面连 ws://127.0.0.1 当作混合内容拦截。请升级浏览器到 Chrome/Edge 154 或更新版本。";
  const recovery = [
    "1) 打印服务没装或没启动：请在本机安装并启动「精臣打印服务 jcPrinterSdk 4.2.1」，确认右下角托盘有打印服务图标。",
    `2) ${permissionHint}`,
    "3) 其他（防火墙/安全软件）：在 PowerShell 执行 Test-NetConnection 127.0.0.1 -Port 37989，TcpTestSucceeded 必须是 True。",
    "4) 以上都不行：直接用「导出 PDF」按钮打印，不需要本机打印服务。",
  ].join("\n");
  return new NiimbotError(
    "service",
    "无法连接本机打印服务（ws://127.0.0.1:37989），可能是打印服务未安装/未启动，或浏览器拦截了本机 ws 连接。",
    { recovery },
  );
}

/** 把任意异常翻译成可展示的 message/recovery */
export function friendlyError(error: unknown): { message: string; recovery?: string } {
  if (error instanceof NiimbotError) {
    const job = error.errorCode !== undefined ? JOB_ERRORS[error.errorCode] : undefined;
    const message = job ? `${job[0]}（错误码 ${error.errorCode}）` : error.message;
    return { message, recovery: error.recovery ?? job?.[1] };
  }
  if (error instanceof Error) {
    const data = (error as Error & { data?: { resultAck?: { errorCode?: number; info?: string } } }).data;
    const code = data?.resultAck?.errorCode;
    if (code !== undefined) {
      const job = JOB_ERRORS[code];
      if (job) return { message: `${job[0]}（错误码 ${code}）`, recovery: job[1] };
      return { message: data?.resultAck?.info || error.message || `打印服务返回错误码 ${code}` };
    }
    return { message: error.message || "打印失败" };
  }
  return { message: "打印失败（未知错误）" };
}

/** resultAck.errorCode 非 0 时抛带错误码的 NiimbotError */
export function jobError(code: number, stage: NiimbotStage, info?: string): NiimbotError {
  const job = JOB_ERRORS[code];
  return new NiimbotError(stage, job ? `${job[0]}（错误码 ${code}）` : (info || `打印服务错误码 ${code}`), {
    errorCode: code,
    recovery: job?.[1],
  });
}

/**
 * 精臣 K3W 直连打印客户端：连接本机打印服务 → 发现/连接 USB 打印机 → initSdk →
 * 绘制画板 → 预览 → startJob/commitJob/endJob 生命周期。
 *
 * 只用官方 SDK 的协议调用，不引入新依赖；Socket 可注入，便于 vitest 里用假实现
 * 完整跑一遍状态机（不连真硬件）。
 *
 * 连接顺序与打印事件流来自官方 Demo/README 和 Demo/js/app/operations.js：
 * startJob →（服务推 commitJob ok!）→ 绘制 → commitJob →（printPages/printCopies
 * 进度）→ 最后一页最后一份完成后 endJob。不能在 startJob 后立刻 commitJob。
 */
import NMPrintSocket from "./Print";
import Socket from "./Socket";
import {
  friendlyError, jobError, NiimbotError, noWifiDevicesError, serviceUnavailableError, type NiimbotStage,
} from "./errors";
import { runPrintJob } from "./printJob";
import type {
  NiimbotPrintPage, NiimbotResponse, NiimbotSocketLike, PrinterDevice, WifiPrinterDevice,
} from "./protocol";

export interface NiimbotProgress {
  stage: NiimbotStage;
  message: string;
}

export type NiimbotProgressHandler = (progress: NiimbotProgress) => void;

export interface NiimbotClientOptions {
  /** 测试注入假 WebSocket 层；默认创建真实 Socket（autoReconnect=false，必须用户点击才连） */
  socketFactory?: () => NiimbotSocketLike;
  connectTimeoutMs?: number;
  jobTimeoutMs?: number;
  /** 打印服务 WebSocket 断开/重连时通知 UI（本客户端不自动重连） */
  onConnectionChange?: (connected: boolean) => void;
}

export interface NiimbotPrintOptions {
  /** 份数：默认 1；K3W 按页统一份数 */
  copies?: number;
  /** K3W 浓度 1~5，默认 3 */
  density?: number;
  /** 1 间隙纸（默认）/ 2 黑标纸 / 3 连续纸 / 5 透明纸 / 10 黑标间隙纸 */
  labelType?: number;
  /** 1 热敏（K3W 只支持热敏） */
  printMode?: number;
  onProgress?: NiimbotProgressHandler;
}

function withTimeout<T>(promise: Promise<T>, ms: number, error: NiimbotError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** USB 发现回包：resultAck.info 是 {"打印机名": 端口} 的 JSON 字符串 */
export function parseUsbDevices(response: NiimbotResponse): PrinterDevice[] {
  const info = response.resultAck?.info;
  if (!info) return [];
  let table: unknown = info;
  if (typeof info === "string") {
    try { table = JSON.parse(info); } catch { return []; }
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  return Object.entries(table as Record<string, unknown>)
    .map(([name, port]) => ({ name, port: Number(port) }))
    .filter(device => device.name.length > 0);
}

/** 取第一个非空字符串字段（打印服务不同版本字段大小写不一致） */
function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

/**
 * Wi-Fi 发现回包：resultAck.info 可能是 JSON 字符串，也可能已经是数组
 * （官方 Demo operations.js 就是这么解析的）。字段兼容大小写；缺 deviceName
 * 或端口非正数的条目丢弃，避免把不可连接的设备列给用户。
 */
export function parseWifiDevices(response: NiimbotResponse): WifiPrinterDevice[] {
  const info = response.resultAck?.info;
  if (!info) return [];
  let list: unknown = info;
  if (typeof info === "string") {
    try { list = JSON.parse(info); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const devices: WifiPrinterDevice[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const deviceName = firstString(record, ["deviceName", "DeviceName", "device_name", "name", "Name"]);
    if (!deviceName) continue;
    const tcpPort = Number(firstValue(record, ["tcpPort", "TcpPort", "tcp_port", "port", "Port"]));
    if (!Number.isFinite(tcpPort) || tcpPort <= 0) continue;
    const ipAddress = firstString(record, ["ipAddress", "IpAddress", "ip_address", "ip", "Ip"]);
    devices.push({ deviceName, tcpPort, ...(ipAddress ? { ipAddress } : {}) });
  }
  return devices;
}

export class NiimbotPrinter {
  private readonly options: NiimbotClientOptions;
  private socket: NiimbotSocketLike | null = null;
  private api: NMPrintSocket | null = null;
  private device: PrinterDevice | null = null;
  /** 当前连接方式：USB（getAllPrinters/selectPrinter）或 Wi-Fi（scanWifiPrinter/connectWifiPrinter） */
  private deviceKind: "usb" | "wifi" | null = null;
  private serviceConnected = false;
  private sdkReady = false;

  constructor(options: NiimbotClientOptions = {}) {
    this.options = options;
  }

  get isConnected(): boolean {
    return this.serviceConnected && this.sdkReady && this.device !== null;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  get connectionMode(): "usb" | "wifi" | null {
    return this.deviceKind;
  }

  get printerServiceConnected(): boolean {
    return this.serviceConnected;
  }

  private get connectTimeoutMs(): number {
    return this.options.connectTimeoutMs ?? 6000;
  }

  private get jobTimeoutMs(): number {
    return this.options.jobTimeoutMs ?? 60000;
  }

  private createSocket(): NiimbotSocketLike {
    if (this.options.socketFactory) return this.options.socketFactory();
    // 绝不自动重连：服务没装时不能每 3 秒重试，必须等用户再次点击
    return new Socket({ autoReconnect: false });
  }

  private async ensureService(onProgress?: NiimbotProgressHandler): Promise<void> {
    if (this.serviceConnected && this.socket?.isOpen()) return;
    const socket = this.socket ?? this.createSocket();
    this.socket = socket;
    this.api = new NMPrintSocket(socket);
    onProgress?.({ stage: "service", message: "正在连接本机打印服务…" });
    try {
      await withTimeout(
        socket.open((open) => {
          this.serviceConnected = open;
          if (!open) {
            // 打印服务断开 = 打印机与 SDK 状态全部失效（SDK README：重连后必须重新连接设备）
            this.device = null;
            this.sdkReady = false;
          }
          this.options.onConnectionChange?.(open);
        }),
        this.connectTimeoutMs,
        serviceUnavailableError(Boolean(socket.loopbackOptionAccepted)),
      );
      this.serviceConnected = true;
    } catch (error) {
      socket.close(true);
      throw error instanceof NiimbotError ? error : serviceUnavailableError(Boolean(socket.loopbackOptionAccepted));
    }
  }

  /** 把 SDK 调用统一成：回包结构校验 + resultAck.errorCode 非 0 抛错 */
  private async call(
    apiName: string,
    stage: NiimbotStage,
    run: () => Promise<NiimbotResponse>,
  ): Promise<NiimbotResponse> {
    try {
      const response = await run();
      if (!response || !response.resultAck) {
        throw new NiimbotError(stage, `打印服务返回结构异常（${apiName}）`);
      }
      const code = response.resultAck.errorCode;
      if (code !== undefined && code !== 0) throw jobError(code, stage, response.resultAck.info);
      return response;
    } catch (error) {
      throw this.normalizeError(error, stage);
    }
  }

  private normalizeError(error: unknown, stage: NiimbotStage): unknown {
    if (error instanceof NiimbotError) return error;
    if (error instanceof Error) {
      const data = (error as Error & { data?: NiimbotResponse }).data;
      const code = data?.resultAck?.errorCode;
      if (code !== undefined) return jobError(code, stage, data?.resultAck?.info);
      return new NiimbotError(stage, error.message || "打印失败");
    }
    return new NiimbotError(stage, friendlyError(error).message);
  }

  private assertReady(stage: NiimbotStage): NMPrintSocket {
    if (!this.api || !this.isConnected) {
      throw new NiimbotError(stage, "还没有连接打印机，请先点击「连接打印机」");
    }
    return this.api;
  }

  /** 只连本机打印服务（ws），不发现/连接打印机；用户显式点击后调用 */
  async connectService(onProgress?: NiimbotProgressHandler): Promise<void> {
    await this.ensureService(onProgress);
  }

  private requireApi(): NMPrintSocket {
    if (!this.api) throw serviceUnavailableError(false);
    return this.api;
  }

  /** 设备连上后统一 initSdk；Wi-Fi/USB 两条路径共用 */
  private async initializeSdk(onProgress?: NiimbotProgressHandler): Promise<void> {
    const api = this.requireApi();
    onProgress?.({ stage: "initSdk", message: "正在初始化打印 SDK…" });
    await this.call("initSdk", "initSdk", () => api.initSdk({ fontDir: "" }));
    this.sdkReady = true;
    onProgress?.({ stage: "initSdk", message: `已连接 ${this.device?.name ?? "打印机"}` });
  }

  /** USB 发现：getAllPrinters（不动打印机连接状态） */
  async discoverUsb(onProgress?: NiimbotProgressHandler): Promise<PrinterDevice[]> {
    await this.ensureService(onProgress);
    const api = this.requireApi();
    onProgress?.({ stage: "discover", message: "正在搜索 USB 打印机…" });
    const found = await this.call("getAllPrinters", "discover", () => api.getAllPrinters());
    const devices = parseUsbDevices(found);
    if (!devices.length) {
      throw new NiimbotError("discover", "未发现 USB 打印机", {
        recovery: "请确认 K3W 已开机、用支持数据传输的 USB 线连接电脑，并已安装对应驱动；"
          + "打印服务托盘图标需为运行状态。若仍搜不到，可先试「导出 PDF」打印。",
      });
    }
    return devices;
  }

  /** USB 连接：selectPrinter → initSdk（Wi-Fi 绝不能走这里） */
  async connectUsb(device: PrinterDevice, onProgress?: NiimbotProgressHandler): Promise<PrinterDevice> {
    await this.ensureService(onProgress);
    const api = this.requireApi();
    onProgress?.({ stage: "connect", message: `正在连接 ${device.name}…` });
    await this.call("selectPrinter", "connect", () => api.selectPrinter(device.name, device.port));
    this.device = device;
    this.deviceKind = "usb";
    await this.initializeSdk(onProgress);
    return device;
  }

  /** Wi-Fi 发现：scanWifiPrinter（SDK 侧 25s 超时） */
  async discoverWifi(onProgress?: NiimbotProgressHandler): Promise<WifiPrinterDevice[]> {
    await this.ensureService(onProgress);
    const api = this.requireApi();
    onProgress?.({ stage: "discover", message: "正在搜索 Wi-Fi 打印机（最长约 25 秒）…" });
    const found = await this.call("scanWifiPrinter", "discover", () => api.scanWifiPrinter());
    const devices = parseWifiDevices(found);
    if (!devices.length) throw noWifiDevicesError();
    return devices;
  }

  /** Wi-Fi 连接：connectWifiPrinter → initSdk（不要调 selectPrinter，会报错误码 23） */
  async connectWifi(device: WifiPrinterDevice, onProgress?: NiimbotProgressHandler): Promise<WifiPrinterDevice> {
    await this.ensureService(onProgress);
    const api = this.requireApi();
    onProgress?.({ stage: "connect", message: `正在连接 Wi-Fi 打印机 ${device.deviceName}…` });
    await this.call("connectWifiPrinter", "connect", () => api.connectWifiPrinter(device.deviceName, device.tcpPort));
    this.device = { name: device.deviceName, port: device.tcpPort };
    this.deviceKind = "wifi";
    await this.initializeSdk(onProgress);
    return device;
  }

  /** 兼容旧入口：USB 便捷连接（连接服务 → 发现第一台 USB 打印机 → 连接 → initSdk） */
  async connect(onProgress?: NiimbotProgressHandler): Promise<PrinterDevice> {
    if (this.isConnected && this.device) return this.device;
    await this.connectService(onProgress);
    const devices = await this.discoverUsb(onProgress);
    return this.connectUsb(devices[0], onProgress);
  }

  private drawElement(api: NMPrintSocket, type: NiimbotPrintPage["elements"][number]["type"], json: Record<string, unknown>): Promise<NiimbotResponse> {
    switch (type) {
      case "text": return api.DrawLableText(json);
      case "qrCode": return api.DrawLableQrCode(json);
      case "qrCodeWithLogo": return api.DrawLableQrCodeWithLogo(json);
      case "barCode": return api.DrawLableBarCode(json);
      case "line": return api.DrawLableLine(json);
      case "graph": return api.DrawLableGraph(json);
      case "image": return api.DrawLableImage(json);
    }
  }

  /** 初始化画板并逐个绘制元素（按模板顺序） */
  async draw(page: NiimbotPrintPage, onProgress?: NiimbotProgressHandler): Promise<void> {
    const api = this.assertReady("draw");
    onProgress?.({ stage: "draw", message: "正在绘制标签…" });
    await this.call("InitDrawingBoard", "draw", () => api.InitDrawingBoard(page.InitDrawingBoardParam));
    for (const element of page.elements) {
      await this.call(PrintApiNames[element.type] ?? element.type, "draw", () => this.drawElement(api, element.type, element.json));
    }
  }

  /** 绘制后让打印服务生成预览图（Base64 data URL），可在真正出纸前确认版式 */
  async preview(page: NiimbotPrintPage, scale = 8, onProgress?: NiimbotProgressHandler): Promise<string> {
    const api = this.assertReady("preview");
    await this.draw(page, onProgress);
    onProgress?.({ stage: "preview", message: "正在生成打印预览…" });
    const response = await this.call("generateImagePreviewImage", "preview", () => api.generateImagePreviewImage(scale));
    const info = response.resultAck?.info;
    let parsed: unknown = info;
    if (typeof info === "string") {
      try { parsed = JSON.parse(info); } catch { parsed = null; }
    }
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const imageData = record.ImageData ?? record.imageData;
    if (typeof imageData !== "string" || !imageData) {
      throw new NiimbotError("preview", "打印服务没有返回预览图（可能 SDK 未初始化或画板为空）");
    }
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : "image/jpeg";
    return `data:${mimeType};base64,${imageData}`;
  }

  /** 单页打印：生命周期在 printJob.ts（startJob → commitJob ok! → 绘制 → commitJob → 进度 → endJob） */
  async print(page: NiimbotPrintPage, options: NiimbotPrintOptions = {}): Promise<void> {
    const api = this.assertReady("print");
    try {
      await runPrintJob(
        { api, page, draw: (p, onProgress) => this.draw(p, onProgress), call: (name, stage, run) => this.call(name, stage, run) },
        {
          copies: Math.max(1, Math.floor(options.copies ?? 1)),
          density: options.density ?? 3,
          labelType: options.labelType ?? 1,
          printMode: options.printMode ?? 1,
          timeoutMs: this.jobTimeoutMs,
          onProgress: options.onProgress,
        },
      );
    } catch (error) {
      throw this.normalizeError(error, "print");
    }
  }

  /** 断开打印机并关闭本机打印服务 WebSocket（不删任务：调用方负责先取消） */
  async disconnect(): Promise<void> {
    const api = this.api;
    if (api) {
      try { await api.closePrinter(); } catch { /* 服务可能已断开 */ }
    }
    this.socket?.close(true);
    this.socket = null;
    this.api = null;
    this.device = null;
    this.deviceKind = null;
    this.serviceConnected = false;
    this.sdkReady = false;
    this.options.onConnectionChange?.(false);
  }
}

/** 绘制元素类型 → 打印服务 apiName（日志用） */
const PrintApiNames: Record<NiimbotPrintPage["elements"][number]["type"], string> = {
  text: "DrawLableText",
  qrCode: "DrawLableQrCode",
  qrCodeWithLogo: "DrawLableQrCodeWithImage",
  barCode: "DrawLableBarCode",
  line: "DrawLableLine",
  graph: "DrawLableGraph",
  image: "DrawLableImage",
};

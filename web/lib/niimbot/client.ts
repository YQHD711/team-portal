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
import { friendlyError, jobError, NiimbotError, serviceUnavailableError, type NiimbotStage } from "./errors";
import { runPrintJob } from "./printJob";
import type { NiimbotPrintPage, NiimbotResponse, NiimbotSocketLike, PrinterDevice } from "./protocol";

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

export class NiimbotPrinter {
  private readonly options: NiimbotClientOptions;
  private socket: NiimbotSocketLike | null = null;
  private api: NMPrintSocket | null = null;
  private device: PrinterDevice | null = null;
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

  /** 用户显式点击后才能调用：连接服务 → 发现第一台 USB 打印机 → 连接 → initSdk */
  async connect(onProgress?: NiimbotProgressHandler): Promise<PrinterDevice> {
    if (this.isConnected && this.device) return this.device;
    await this.ensureService(onProgress);
    const api = this.api;
    if (!api) throw serviceUnavailableError(false);

    onProgress?.({ stage: "discover", message: "正在搜索 USB 打印机…" });
    const found = await this.call("getAllPrinters", "discover", () => api.getAllPrinters());
    const devices = parseUsbDevices(found);
    if (!devices.length) {
      throw new NiimbotError("discover", "未发现 USB 打印机", {
        recovery: "请确认 K3W 已开机、用支持数据传输的 USB 线连接电脑，并已安装对应驱动；"
          + "打印服务托盘图标需为运行状态。若仍搜不到，可先试「导出 PDF」打印。",
      });
    }
    const device = devices[0];
    onProgress?.({ stage: "connect", message: `正在连接 ${device.name}…` });
    await this.call("selectPrinter", "connect", () => api.selectPrinter(device.name, device.port));
    this.device = device;

    onProgress?.({ stage: "initSdk", message: "正在初始化打印 SDK…" });
    await this.call("initSdk", "initSdk", () => api.initSdk({ fontDir: "" }));
    this.sdkReady = true;
    onProgress?.({ stage: "initSdk", message: `已连接 ${device.name}` });
    return device;
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

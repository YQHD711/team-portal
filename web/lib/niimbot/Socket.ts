/**
 * 精臣 PC Web SDK 通信层（vendor 自官方包 web-4.2.1_20260902/pc-react/src/Socket.ts）。
 *
 * 与上游的差异（都是为了接进本项目，逐条注明，协议本身未改）：
 *  1. open() 失败会 reject（上游永不 reject，只回调），否则页面无法显示"打印服务没装"。
 *  2. autoReconnect 可关闭（默认 true 保持上游行为）。直连打印场景传 false：服务未安装时
 *     不能每 3 秒无限重试，必须等用户再次点击。
 *  3. 增加 isOpen()，不再通过 (socket as any)._websocket 读私有字段。
 *  4. HTTPS 页面连本机 ws:// 的官方解法：第二参数传 { targetAddressSpace: "loopback" }
 *     （Chrome/Edge 154+ 支持，会弹「访问本地设备」权限）。旧浏览器会把它当 protocols
 *     并抛错，此时回退到 new WebSocket(url)。
 *  5. 用协议类型替换 any；消息仍是外部输入，解析失败按忽略处理。
 */
import type { NiimbotRequest, NiimbotResponse, NiimbotSocketLike } from "./protocol";

interface SocketOptions {
  resetTime: number;
  timeout: number;
  autoReconnect: boolean;
}

interface PromisePoolItem {
  timestamp: number;
  content: NiimbotRequest;
  resolve: (value: NiimbotResponse) => void;
  reject: (reason?: unknown) => void;
  timeoutCallback: ReturnType<typeof setTimeout>;
}

/** WebSocket 第二参数的实验性扩展；TS DOM 类型还没有，运行时由浏览器识别 */
interface LoopbackSocketOptions {
  targetAddressSpace: "loopback";
}

const SERVICE_URL = "ws://127.0.0.1:37989";

export default class Socket implements NiimbotSocketLike {
  public isProcessingCommitJob = false;
  public url: string;
  public options: SocketOptions = { resetTime: 3000, timeout: 10000, autoReconnect: true };
  public customClose = false;
  public printListeners = new Set<(msg: NiimbotResponse) => void>();
  /** 浏览器是否接受了 { targetAddressSpace: "loopback" }（决定失败时给哪种提示） */
  public loopbackOptionAccepted = false;

  private promisePool: Record<string, PromisePoolItem> = {};
  private _websocket: WebSocket | undefined;
  private openChangeCallback: ((isOpen: boolean) => void) | null = null;

  constructor(options: Partial<SocketOptions> = {}) {
    this.url = SERVICE_URL;
    this.options = { ...this.options, ...options };
  }

  /** 新版浏览器用 options bag 申请本机回环访问；旧浏览器抛错则退回普通构造 */
  private createWebSocket(): WebSocket {
    const loopbackOptions: LoopbackSocketOptions = { targetAddressSpace: "loopback" };
    try {
      const ws = new WebSocket(this.url, loopbackOptions as unknown as string[]);
      this.loopbackOptionAccepted = true;
      return ws;
    } catch {
      // 旧浏览器把第二参数当 protocols → 对象不合法抛 SyntaxError，回退到无参数构造
      this.loopbackOptionAccepted = false;
      return new WebSocket(this.url);
    }
  }

  public isOpen(): boolean {
    return Boolean(this._websocket && this._websocket.readyState === WebSocket.OPEN);
  }

  /** 打开 WebSocket；失败 reject（不会自动吞掉错误） */
  public open(
    openChange?: (isOpen: boolean) => void,
    onMessageCallback?: (msg: NiimbotResponse) => void,
  ): Promise<unknown> {
    if (openChange) this.openChangeCallback = openChange;
    return new Promise((resolve, reject) => {
      if (this._websocket && this._websocket.readyState === WebSocket.OPEN) {
        resolve({ ws: this });
        return;
      }
      let settled = false;
      const ws = this.createWebSocket();
      this._websocket = ws;
      ws.onopen = (e: Event) => {
        settled = true;
        openChange?.(true);
        resolve({ e, ws: this });
      };
      ws.onerror = () => {
        openChange?.(false);
        this.isProcessingCommitJob = false;
        if (!settled) {
          settled = true;
          reject(new Error("无法连接本机打印服务"));
        }
        this._websocket = undefined;
        this.handleDisconnect();
      };
      ws.onclose = () => {
        openChange?.(false);
        this.printListeners.clear();
        this._websocket = undefined;
        this.handleDisconnect();
      };
      ws.onmessage = (e: MessageEvent) => {
        const msg = this.parseMessage(e.data);
        if (msg) this.messageRouter(msg, onMessageCallback);
      };
    });
  }

  private parseMessage(data: unknown): NiimbotResponse | null {
    if (typeof data !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === "object" ? (parsed as NiimbotResponse) : null;
    } catch {
      return null;
    }
  }

  private handleDisconnect(): void {
    if (this.customClose) {
      this.customClose = false;
      return;
    }
    if (!this.options.autoReconnect) return;
    const timer = setTimeout(() => {
      try {
        this.open(this.openChangeCallback ?? undefined).then(() => clearTimeout(timer)).catch(() => {
          clearTimeout(timer);
          this.openChangeCallback?.(false);
        });
      } catch {
        this.openChangeCallback?.(false);
      }
    }, this.options.resetTime);
  }

  /**
   * 消息路由：先结算请求池，再把打印任务/暂停事件广播给监听器。
   * 保留上游三条特殊规则：commitJob 的主动上报不能消费请求；OnPauseStatus 不是异常回包；
   * cacheStatus=pause 的重复上报直接丢弃。
   */
  private messageRouter(msg: NiimbotResponse, onMessageCallback?: (msg: NiimbotResponse) => void): void {
    const apiName = String(msg.apiName || "");
    const resultAck = msg.resultAck;
    const isCommitJob = apiName === "commitJob";
    const isPauseStatus = apiName.toLowerCase() === "onpausestatus";
    const isCommitJobPauseReport = isCommitJob
      && Boolean(resultAck) && String(resultAck?.cacheStatus || "").toLowerCase() === "pause";
    if (isCommitJobPauseReport) return;

    const isCommitJobActiveReport = isCommitJob && Boolean(resultAck)
      && resultAck?.errorCode === 0 && resultAck?.info !== "commitJobApi Success!";

    if (apiName && apiName !== "getPrinterHighLevelInfo" && apiName !== "printStatus"
      && !isCommitJobActiveReport && !isPauseStatus) {
      this.handleApiResponse(msg);
    }
    if (isCommitJob || isPauseStatus) this.handleEventPush(msg);
    if (apiName === "getPrinterHighLevelInfo" || apiName === "printStatus") {
      onMessageCallback?.(msg);
    }
  }

  private handleApiResponse(msg: NiimbotResponse): void {
    const apiName = msg.apiName;
    const req = apiName ? this.promisePool[apiName] : undefined;
    if (!apiName || !req) return;
    const ack = msg.resultAck;
    if (msg.apiName === "commitJob") {
      this.cleanupRequest(msg.apiName, req);
      if (ack?.errorCode === 0) {
        req.resolve(msg);
        this.isProcessingCommitJob = true;
      } else {
        this.isProcessingCommitJob = false;
        const error = new Error(ack?.info || "Unknown Error") as Error & { data?: NiimbotResponse };
        error.data = msg;
        req.reject(error);
      }
      return;
    }
    if (ack?.errorCode !== 0) this.isProcessingCommitJob = false;
    req.resolve(msg);
    this.cleanupRequest(apiName, req);
  }

  private handleEventPush(msg: NiimbotResponse): void {
    this.printListeners.forEach(listener => {
      try {
        listener(msg);
      } catch (error) {
        console.error("打印任务监听器执行失败:", error);
      }
    });
    const isPauseReport = String(msg.apiName || "").toLowerCase() === "onpausestatus";
    if (msg.resultAck?.errorCode !== 0 && !isPauseReport) this.isProcessingCommitJob = false;
  }

  private cleanupRequest(apiName: string, req: PromisePoolItem): void {
    clearTimeout(req.timeoutCallback);
    delete this.promisePool[apiName];
  }

  public close(closing = true): void {
    this.customClose = closing;
    if (this._websocket && this._websocket.readyState === WebSocket.OPEN) {
      this.clearAllListeners();
      this.openChangeCallback?.(false);
      this._websocket.close();
    }
    this._websocket = undefined;
  }

  public send(content: NiimbotRequest, timeout: number | null = null): Promise<NiimbotResponse> {
    const timestamp = Date.now();
    const timeoutCallback = setTimeout(() => {
      // 发起 commitJob 后超时：恢复"未处理"状态，避免后续正常回包被跳过
      if (content.apiName === "commitJob") this.isProcessingCommitJob = true;
      const req = this.promisePool[content.apiName];
      if (req && req.timestamp === timestamp) {
        req.resolve({ apiName: content.apiName, resultAck: { errorCode: 22 }, Error: "打印超时" });
        clearTimeout(req.timeoutCallback);
        delete this.promisePool[content.apiName];
      }
    }, timeout !== null ? timeout : this.options.timeout);

    return new Promise((resolve, reject) => {
      this.promisePool[content.apiName] = { timestamp, content, resolve, reject, timeoutCallback };
      if (this.isOpen()) {
        this._websocket?.send(JSON.stringify({ ...content }));
      } else {
        // 上游行为：未连接不发，直接以超时错误码结算，让 UI 走统一错误提示
        resolve({ apiName: content.apiName, resultAck: { errorCode: 22 }, Error: "打印超时" });
      }
    });
  }

  public addPrintListener(callback: (msg: NiimbotResponse) => void): void {
    this.printListeners.add(callback);
  }

  public removePrintListener(callback: (msg: NiimbotResponse) => void): void {
    this.printListeners.delete(callback);
  }

  public clearAllListeners(): void {
    this.printListeners.clear();
  }

  public getListenersCount(): number {
    return this.printListeners.size;
  }
}

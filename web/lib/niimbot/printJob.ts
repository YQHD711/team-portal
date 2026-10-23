/**
 * 打印任务生命周期（从 client.ts 拆出，单文件 <200 行）：
 * startJob → 等 commitJob ok! → 绘制 → commitJob → 打印进度 → endJob。
 *
 * 事件流依据官方 Demo（pc-react / Demo/js/app/operations.js）：
 * startJob 后不能立刻 commitJob，必须等服务推 "commitJob ok!"（允许提交第一页）；
 * commitJob 的 API 回包（"commitJobApi Success!"）与主动上报（"commitJob ok!"）是两回事。
 */
import type NMPrintSocket from "./Print";
import { jobError, NiimbotError, type NiimbotStage } from "./errors";
import type { NiimbotPrintPage, NiimbotResponse } from "./protocol";

export type PrintJobStage = "startJob" | "draw" | "commitJob" | "print" | "endJob";

export interface PrintJobProgress {
  /** 子集：startJob / draw / commitJob / print / endJob（与 client 的 NiimbotProgress 兼容） */
  stage: NiimbotStage;
  message: string;
}

export interface PrintJobOptions {
  copies: number;
  density: number;
  labelType: number;
  printMode: number;
  timeoutMs: number;
  onProgress?: (progress: PrintJobProgress) => void;
}

export interface PrintJobDeps {
  api: NMPrintSocket;
  page: NiimbotPrintPage;
  /** 初始化画板 + 逐个元素绘制（由 client 实现） */
  draw: (page: NiimbotPrintPage, onProgress?: (p: PrintJobProgress) => void) => Promise<void>;
  /** 调 SDK 并校验 resultAck（由 client 实现） */
  call: (apiName: string, stage: NiimbotStage, run: () => Promise<NiimbotResponse>) => Promise<NiimbotResponse>;
}

interface Waiter {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function waiter(): Waiter {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

export async function runPrintJob(deps: PrintJobDeps, options: PrintJobOptions): Promise<void> {
  const { api, page, draw, call } = deps;
  const { onProgress } = options;
  const copies = Math.max(1, Math.floor(options.copies));
  const ready = waiter();
  const done = waiter();
  const failed = waiter();
  // 任务结束时另外两个 waiter 可能永远不 settle；提前挂 noop catch，避免 unhandled rejection
  void ready.promise.catch(() => {});
  void done.promise.catch(() => {});
  void failed.promise.catch(() => {});
  let printedPages = 0;
  let printedCopies = 0;

  const listener = (msg: NiimbotResponse): void => {
    const apiName = String(msg.apiName || "");
    const ack = msg.resultAck ?? {};
    if (apiName.toLowerCase() === "onpausestatus") {
      failed.reject(jobError(ack.errorCode ?? -1, "print", ack.info));
      return;
    }
    if (apiName !== "commitJob") return;
    if (ack.errorCode !== undefined && ack.errorCode !== 0) {
      failed.reject(jobError(ack.errorCode, "commitJob", ack.info));
      return;
    }
    if (ack.info === "commitJob ok!") ready.resolve();
    if (ack.printPages !== undefined || ack.printCopies !== undefined) {
      printedPages = Number(ack.printPages ?? printedPages);
      printedCopies = Number(ack.printCopies ?? printedCopies);
      onProgress?.({
        stage: "print",
        message: `正在打印：第 ${printedPages} 页 / 本页第 ${printedCopies} 份（共 ${copies} 份）`,
      });
      if (printedPages >= 1 && printedCopies >= copies) done.resolve();
    }
  };

  api.addPrintListener(listener);
  try {
    onProgress?.({ stage: "startJob", message: "正在启动打印任务…" });
    await call("startJob", "startJob", () => api.startJob(options.density, options.labelType, options.printMode, copies));

    await withTimeout(
      ready.promise,
      options.timeoutMs,
      new NiimbotError("startJob", "等待打印机就绪超时", {
        recovery: "请检查打印机是否卡纸/开盖，或在打印机上重新装纸后重试。",
      }),
    );

    await draw(page, p => onProgress?.(p));

    onProgress?.({ stage: "commitJob", message: "正在提交标签数据…" });
    await call("commitJob", "commitJob", () => api.commitJob(
      null,
      JSON.stringify({ printerImageProcessingInfo: { printQuantity: copies } }),
    ));

    await withTimeout(
      Promise.race([done.promise, failed.promise]),
      options.timeoutMs,
      new NiimbotError("print", "打印超时，没有等到打印机完成进度", {
        recovery: "请确认打印机出纸正常；若已卡住，请在打印机上取消任务后再试。",
      }),
    );

    onProgress?.({ stage: "endJob", message: "正在结束打印任务…" });
    await call("endJob", "endJob", () => api.endJob());
    onProgress?.({ stage: "endJob", message: "打印完成" });
  } catch (error) {
    // 失败后尽量停止任务，避免下一单被"打印机忙"拒绝；停止本身失败不覆盖原错误
    try { await api.cancelJob(); } catch { /* ignore */ }
    throw error;
  } finally {
    api.removePrintListener(listener);
  }
}

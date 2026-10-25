/**
 * 打印任务生命周期（从 client.ts 拆出）：支持**多页**连续打印。
 *
 * startJob(count = 页数 × 每页份数) → 等 commitJob ok! → 逐页：
 *   绘制画板 → commitJob(每页份数) → 等该页打印完成 → 等下一页 commitJob ok!
 * → 最后一页完成后 endJob。
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
  /** 多页：每页一张标签；份数统一作用于每一页 */
  pages: NiimbotPrintPage[];
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

/** 可重复触发的信号（服务每页推一次 commitJob ok!，允许提前到达/排队） */
interface Signal {
  wait(): Promise<void>;
  fire(): void;
}

function signal(): Signal {
  let pending = 0;
  const waiters: (() => void)[] = [];
  return {
    wait() {
      if (pending > 0) { pending -= 1; return Promise.resolve(); }
      return new Promise<void>(resolve => waiters.push(resolve));
    },
    fire() {
      pending += 1;
      const next = waiters.shift();
      if (next) { pending -= 1; next(); }
    },
  };
}

/** 多页打印：pages 长度 = 页数，copies = 每页份数（不是总份数） */
export async function runPrintJobPages(deps: PrintJobDeps, options: PrintJobOptions): Promise<void> {
  const { api, pages, draw, call } = deps;
  const { onProgress } = options;
  const totalPages = pages.length;
  if (totalPages === 0) throw new NiimbotError("print", "没有可打印的页面");
  const copies = Math.max(1, Math.floor(options.copies));
  const totalCopies = totalPages * copies;

  const ready = signal();          // 服务允许提交下一页（可排队）
  const failed = waiter();         // 打印中异常（开盖/缺纸/断连）
  let pageDone: Waiter | null = null;
  void failed.promise.catch(() => {});
  let printedPages = 0;
  let printedCopies = 0;
  let currentIndex = 0;

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
    if (ack.info === "commitJob ok!") ready.fire();
    if (ack.printPages !== undefined || ack.printCopies !== undefined) {
      printedPages = Number(ack.printPages ?? printedPages);
      printedCopies = Number(ack.printCopies ?? printedCopies);
      onProgress?.({
        stage: "print",
        message: `正在打印：第 ${Math.min(printedPages, totalPages)}/${totalPages} 页 / 本页第 ${printedCopies} 份（每页 ${copies} 份）`,
      });
      if (printedPages >= currentIndex + 1 && printedCopies >= copies) pageDone?.resolve();
    }
  };

  api.addPrintListener(listener);
  try {
    onProgress?.({ stage: "startJob", message: `正在启动打印任务（共 ${totalPages} 页 / ${totalCopies} 份）…` });
    await call("startJob", "startJob", () => api.startJob(options.density, options.labelType, options.printMode, totalCopies));

    await withTimeout(
      ready.wait(),
      options.timeoutMs,
      new NiimbotError("startJob", "等待打印机就绪超时", {
        recovery: "请检查打印机是否卡纸/开盖，或在打印机上重新装纸后重试。",
      }),
    );

    for (let index = 0; index < totalPages; index += 1) {
      currentIndex = index;
      pageDone = waiter();
      void pageDone.promise.catch(() => {});
      const pageNo = index + 1;

      onProgress?.({ stage: "draw", message: `正在绘制第 ${pageNo}/${totalPages} 张标签…` });
      await draw(pages[index], p => onProgress?.(p));

      onProgress?.({ stage: "commitJob", message: `正在提交第 ${pageNo}/${totalPages} 张标签…` });
      await call("commitJob", "commitJob", () => api.commitJob(
        null,
        JSON.stringify({ printerImageProcessingInfo: { printQuantity: copies } }),
      ));

      await withTimeout(
        Promise.race([pageDone.promise, failed.promise]),
        options.timeoutMs,
        new NiimbotError("print", `第 ${pageNo}/${totalPages} 页打印超时`, {
          recovery: "请确认打印机出纸正常；若已卡住，请在打印机上取消任务后再试。",
        }),
      );

      if (index < totalPages - 1) {
        // 服务会在上一页完成后推 commitJob ok!，才允许提交下一页
        await withTimeout(
          ready.wait(),
          options.timeoutMs,
          new NiimbotError("commitJob", `等待第 ${pageNo + 1} 页就绪超时`, {
            recovery: "请检查打印机是否卡住；必要时取消任务后重试。",
          }),
        );
      }
    }

    onProgress?.({ stage: "endJob", message: "正在结束打印任务…" });
    await call("endJob", "endJob", () => api.endJob());
    onProgress?.({ stage: "endJob", message: `打印完成（${totalPages} 页 / 共 ${totalCopies} 份）` });
  } catch (error) {
    // 失败后尽量停止任务，避免下一单被"打印机忙"拒绝；停止本身失败不覆盖原错误
    try { await api.cancelJob(); } catch { /* ignore */ }
    throw error;
  } finally {
    api.removePrintListener(listener);
  }
}

/** 单页兼容入口（既有调用方/测试仍在用） */
export async function runPrintJob(
  deps: Omit<PrintJobDeps, "pages"> & { page: NiimbotPrintPage },
  options: PrintJobOptions,
): Promise<void> {
  const { page, ...rest } = deps;
  await runPrintJobPages({ ...rest, pages: [page] }, options);
}

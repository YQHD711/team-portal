/**
 * 构建信息 —— 由 CI 通过 Docker build-arg 注入，编译期内联进前端产物。
 *
 * 为什么要有它：前端是 SPA，浏览器会缓存旧的 JS chunk；服务器自动部署是否生效
 * 光看页面"没变化"根本判断不了（可能是没部署，也可能是缓存）。
 * 页脚直接打出「CI 编号 + commit」，一眼就能和 Actions 页面对上。
 *
 * 注意：NEXT_PUBLIC_* 必须写成完整的静态表达式（process.env.NEXT_PUBLIC_X），
 * 否则 Next 不做替换，运行时读到 undefined。
 */
const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const runNumber = process.env.NEXT_PUBLIC_BUILD_RUN ?? "";

/** 短 commit（7 位）；未注入时为 "dev"（本地构建）。 */
export const buildShortSha = sha ? sha.slice(0, 7) : "dev";

/** CI 运行编号，例如 "120"；本地构建为空。 */
export const buildRunNumber = runNumber;

/** 页脚展示用：「#120 · 2f72a11」，本地构建则是「dev」。 */
export const buildLabel = runNumber ? `#${runNumber} · ${buildShortSha}` : buildShortSha;

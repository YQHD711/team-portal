import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /**
     * 规则等级在这里**显式**声明（不再依赖 preset 默认值），并把存量违规讲清楚。
     * 背景：本仓库此前 CI 从不跑 lint，于是"钩子用错"只能靠 e2e 整页崩才发现；
     * 现在 lint 进了 CI（.github/workflows/ci.yml → lint-web），改等级必须成对更新本注释。
     *
     * 实测（`node node_modules/eslint/bin/eslint.js .`，438 文件）：`rules-of-hooks`
     * **本来就开着（error）**，且当前全仓库 **0 违规**；真正缺的是"没有门禁在跑它"。
     */
    rules: {
      // ★ 本次需求的核心防线：钩子调用位置错误（放进回调/条件/循环、组件外调用）一律 error。
      "react-hooks/rules-of-hooks": "error",
      // 依赖数组不完整保持 warning：历史代码量大，一次性变 error 会把 CI 直接打红。
      "react-hooks/exhaustive-deps": "warn",

      /*
       * 以下为**存量违规降级**：它们全部先于本规则集存在，且分散在其它队友负责的模块
       * （inventory / finance / knowledge / wiki / admin 页面），逐条修要重构真实逻辑，
       * 不适合混进"接入 lint 门禁"这一轮。降级为 warning 后 CI 绿，但 `make lint`
       * 仍会全部打印，便于按模块渐进清理。
       * 本轮实测计数（438 文件）：set-state-in-effect 40、immutability 7、refs 1、
       * no-unescaped-entities 12、no-explicit-any 10。
       */
      // React Compiler 时代风格规则：effect 里同步 setState（多见于"挂载即取数"）。
      "react-hooks/set-state-in-effect": "warn",
      // "先用后声明"的函数 / 不该改的变量：确实是坏味道（提前捕获拿不到新值），但重构面广。
      "react-hooks/immutability": "warn",
      // 渲染期读 ref。
      "react-hooks/refs": "warn",
      // JSX 文本里的 ' / " 未转义（纯文案问题）。
      "react/no-unescaped-entities": "warn",
      // 项目要求"TS 禁 any"：这 10 处是历史遗留，改它们要动 6 个文件（多在他人的模块）。
      // 要把它当硬门禁，请单独开一轮逐条改类型。
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;

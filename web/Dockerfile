FROM node:24-alpine AS base

# Next.js 16 dev allowedDevOrigins 由 next.config.ts 读取 process.env,build-arg 注入
ARG ALLOWED_DEV_ORIGINS
ENV ALLOWED_DEV_ORIGINS=$ALLOWED_DEV_ORIGINS

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
# npm ci 要求 package-lock.json;仓库只提交了 package.json,用 npm install --omit=dev 替代
COPY package*.json ./
RUN npm config set registry ${NPM_REGISTRY} \
 && npm install --omit=dev --no-audit --prefer-offline || npm install --no-audit --prefer-offline

FROM base AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 非 root 用户(审计 #3)
RUN chown -R node:node /app
USER node

EXPOSE 3000
# bind mount ./web:/app 后容器内的 /app/node_modules 是空目录(host 上没装 node),
# dev 模式需要 npm install 后才有 next 命令;缺失则补装
CMD ["sh", "-c", "[ -x node_modules/.bin/next ] || npm install --omit=dev --no-audit; exec npm run dev"]

FROM base AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG API_PROXY_URL=http://localhost:8080
ENV API_PROXY_URL=$API_PROXY_URL
# build 阶段需要 devDependencies (Tailwind/PostCSS/TypeScript 等工具链);
# prod 运行时由 standalone output 自包含,不再需要 devDependencies。
COPY package*.json ./
RUN npm config set registry ${NPM_REGISTRY} \
 && npm install --no-audit --prefer-offline
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=1024 npm run build

FROM base AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# 非 root 用户(审计 #3) — node:alpine 自带 `node` 用户
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]

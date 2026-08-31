FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
# npm ci 要求 package-lock.json;仓库只提交了 package.json,用 npm install --omit=dev 替代
COPY package*.json ./
RUN npm install --omit=dev --no-audit --prefer-offline || npm install --no-audit --prefer-offline

FROM base AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 非 root 用户(审计 #3)
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
WORKDIR /app
ARG API_PROXY_URL=http://localhost:8080
ENV API_PROXY_URL=$API_PROXY_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

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

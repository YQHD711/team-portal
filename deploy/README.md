# TeamPortal 部署与工作流手册（开发 Agent 必读）

> 面向对象：AI 开发 Agent / 新成员。读完即可安全地开发、部署、回滚，不踩坑。
> 最后更新：2026-09-05（全自动部署闭环上线日）

---

## 1. 系统架构一览

```
开发者 push (main)
   │
   ▼
GitHub Actions (ci.yml)
   ├─ test-csharp   74 用例  dotnet test        (tests/api)
   ├─ test-web      19 用例  vitest            (web/tests)
   ├─ test-python   18 用例  pytest            (tests/ai)
   └─ e2e-smoke      5 用例  Playwright        (web/e2e)  ← 生产构建+route mock
   │  （四者并行，PR 和 main 都跑）
   ▼
build-push（仅 main push，需以上全绿）
   └─ 3 镜像推 ghcr.io/yqhd711/teamportal-{backend,frontend,ai-service}
      tag = latest + sha-<完整40位commit>
   ▼
服务器 systemd timer（teamportal-autodeploy.timer，每 5 分钟）
   └─ root 跑 deploy/auto-deploy.sh
      查 main 最新全绿 run → 与 deploy/.deployed_sha 比对 → 不同则自动部署
   ▼
deploy.sh（纯拉取，服务器永不构建）→ docker compose up -d --no-build
```

**服务器**：阿里云 8.137.161.160（admin 用户，1.8G 内存，内存红线意识必须刻进脑子）
**栈**：.NET 10 后端(8080) + Next.js 16 前端(3000) + FastAPI AI 服务(9001) + wiki-nginx(80)，全 Docker

---

## 2. 日常开发流程

1. 改代码 → push 到 main（或开 PR 看门禁）
2. CI 全绿后 **5 分钟内自动上线**，什么都不用做
3. 想看进度：`gh run list` 或仓库 Actions 页；各 job ~25 分钟内跑完（E2E 最重 ~15 分钟）

**改前端后必须知道的事：**
- docker build 会用 tsc 严格检查 `web/` 下**所有** ts/tsx（含 tests/ 和 e2e/），类型不干净 = 镜像构建失败
- 提交前本地过一遍：`cd web && npx vitest run && npx tsc --noEmit`
- 前端测试位置：单元 `web/tests/*.test.tsx`，E2E `web/e2e/*.spec.ts`（E2E 用 `page.route` mock 全部 `/api/*`，无后端依赖）

---

## 3. 部署操作

### 3.1 自动部署（默认路径，零操作）
- push 全绿 → 5 分钟内自动拉取上线
- 部署日志：`~/teamportal/deploy/auto-deploy.log`（空闲零输出，只在有动作时写）
- 当前版本：`cat ~/teamportal/deploy/.deployed_sha`

### 3.2 手动部署 / 回滚 ⚠️ 回滚前必读
```bash
# 回滚到指定 commit（镜像 tag 是 sha-<完整40位sha>，短 sha 会 manifest unknown！）
touch ~/teamportal/deploy/AUTO_DEPLOY_OFF     # ① 先暂停自动部署，否则 5 分钟后会被拉回最新
bash ~/teamportal/deploy/deploy.sh sha-<完整40位sha>   # ② 回滚
# 完整 sha 获取：cd ~/teamportal && git rev-parse HEAD~N
rm ~/teamportal/deploy/AUTO_DEPLOY_OFF        # ③ 调试完恢复自动跟踪
```

### 3.3 deploy.sh 内部步骤（改它之前先读懂）
```
1. git pull（root 跑时自动以 admin 身份，防 .git 属主污染；失败不阻断）
2. docker compose pull（TEAMPORTAL_IMAGE_TAG 必须在此之前 export！）
3. docker compose up -d --no-build   ← --no-build 是保命符，永远不许删
4. 恢复 wiki（独立 compose，严禁 --remove-orphans，会误删 wiki-nginx）
5. docker image prune
```

---

## 4. 血泪教训（每条都真实炸过）

| ⚠️ | 教训 | 后果 |
|---|---|---|
| 1 | **deploy.sh 的 `export TEAMPORTAL_IMAGE_TAG` 必须在 pull 之前** | tag 时序错 → up 找不到 sha 镜像 → 服务器源码构建 → 1.8G 内存打爆全机假死（2026-09-05 实锤） |
| 2 | **up 必须 --no-build** | 拉取式部署的一切异常都应"报错退出"而非"就地构建" |
| 3 | **镜像 tag 用完整 40 位 sha** | CI 是 `sha-${{ github.sha }}`（完整位），传短 sha = manifest unknown |
| 4 | **回滚前先 touch AUTO_DEPLOY_OFF** | 否则回滚 5 分钟后被 watcher 自动拉回最新 |
| 5 | **服务器上禁止任何构建**（前端尤其致命） | 内存红线：dotnet/next build 会让 1.8G 机器 SSH 都连不上 |
| 6 | **wiki-nginx 归 docker-compose.wiki.yml 管** | 主 compose up 加 --remove-orphans 会误删 wiki |
| 7 | root 跑 git 操作会污染 .git 属主 | deploy.sh 已内置 `sudo -u admin` 防护，别绕过 |
| 8 | **裸 gitignore 规则会吞源码**：`logs/` 匹配任意深度，仓库重建时把 `web/app/.../admin/logs/` 页面从索引剔除 → CI 镜像 404 | 规则一律限定根目录 `/logs/`；服务器工作区的孤儿文件会让本地一切正常，极具迷惑性 |
| 9 | **CI 干净 checkout ≠ 服务器工作区** | 调试"线上缺东西"先 `git ls-files` 确认文件真的入库了；E2E 已加路由完整性守卫防复发 |

---

## 5. 故障排查速查

```bash
# 服务状态
docker ps                                    # 四容器应全 healthy
docker logs teamportal-backend-1 --tail 50   # 后端日志
# 自动部署为什么没动？
cat ~/teamportal/deploy/auto-deploy.log      # 空输出 = 没检测到新全绿 run（CI 还没绿完）
ls ~/teamportal/deploy/AUTO_DEPLOY_OFF       # 存在 = watcher 被人暂停了
systemctl list-timers teamportal-autodeploy.timer
# 内存告急时
free -m; docker stats --no-stream
# 强制让 watcher 重新部署当前最新
rm ~/teamportal/deploy/.deployed_sha         # 下一轮(≤5分钟)会重新执行部署
```

- CI 查询走匿名 API：`https://api.github.com/repos/YQHD711/team-portal/actions/runs`
- 镜像 tag 实测验证（匿名探测不可信）：
  `curl -H "Authorization: Bearer $(curl -s 'https://ghcr.io/token?scope=repository:yqhd711/teamportal-frontend:pull' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')" https://ghcr.io/v2/yqhd711/teamportal-frontend/tags/list`

---

## 6. 告警

CI 任何 job 失败 → 飞书群通知（notify job）。需仓库 secret `FEISHU_WEBHOOK_URL`（飞书群 → 设置 → 群机器人 → 自定义机器人，安全设置建议勾"自定义关键词：CI"）。未配置时静默跳过，**配好前失败只有 GitHub 邮件**。

---

## 7. 给 AI Agent 的行为准则

1. **永远不要在服务器上构建任何东西**——所有构建产物只来自 ghcr
2. 改 deploy/ 下脚本必须先读完本手册第 3.3、4 节，改完 `bash -n` 验语法再提交
3. push 前本地跑 `npx vitest run && npx tsc --noEmit`（web 目录），别让 CI 当第一道语法检查
4. 涉及 compose 文件的改动，先想 wiki-nginx 会不会被波及
5. 回滚操作必须带 AUTO_DEPLOY_OFF 三步曲（见 3.2），一步不能省
6. 服务器内存 <500MB 可用时，先停止手头操作观察，别雪上加霜

# 可选：宿主 3000 → nginx → frontend（让审计拿到真实客户端 IP）

## 为什么需要
`docker-compose.yml` 直接把 frontend 的 3000 发布到宿主时，**frontend 容器的 TCP 对端是宿主侧的转发地址**
（线上实测恒为 `10.255.1.3`）。Next 只在「客户端没带 `X-Forwarded-For`」时才填**它自己的对端**，
所以审计日志里所有真实用户都是同一个内部地址，无法定位"谁、从哪来"。

让 nginx 站在浏览器那一侧、并用 `$remote_addr` **覆盖** `X-Forwarded-For` 后：
* 后端（`ForwardedHeaders__KnownProxies=172.28.0.2`，只信任 frontend，`ForwardLimit=1`）取到的是**真实客户端 IP**；
* 客户端伪装的 `X-Forwarded-For` 被 nginx 丢掉 → **伪造无效**。

## 启用 / 回滚（各一行）
```bash
bash deploy/nginx-proxy.sh enable     # 启用：nginx 接管宿主 3000
bash deploy/nginx-proxy.sh disable    # 回滚：frontend 恢复直接发布 3000，nginx 下线
bash deploy/nginx-proxy.sh status     # 当前形态
```

* **拓扑不会自己变**：本拓扑在独立文件 `docker-compose.nginx.yml` 里，systemd 自动部署只带
  `docker-compose.yml + docker-compose.ghcr.yml`（已用 `docker compose config` 复核：默认形态下
  只有 frontend/backend，frontend 仍发布 3000，nginx 不存在）。
* **回滚路径不依赖 nginx 可用**：`disable` 先用 base 组合把 frontend 重新发布 3000（`--force-recreate`），
  确认 HTTP 可用后才移除 nginx 容器；任一步失败会打印现场并以非 0 退出。
* enable 之后脚本自己会 `curl` 一次 3000 做门禁，不通过就提示立刻回滚并把 nginx 日志打出来。

## 启用后要看什么（验收）
1. **真实 IP**：用浏览器登录一次 → 管理端「操作日志」里该条的 IP 应是**你的公网/内网客户端 IP**，
   不再是 `10.255.1.3`。
2. **伪造对照**：`curl -H 'X-Forwarded-For: 1.2.3.4' http://<host>:3000/api/auth/login -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' -H 'Content-Type: application/json'`
   → 审计里**不应**出现 `1.2.3.4`（应为你的真实对端地址）。
3. 站点功能正常：登录、固件下载、大文件上传（`client_max_body_size 1024m` 已在 nginx 里放宽）。

## 取舍与风险
* 多一层 nginx：多一个容器与一次转发（对本站流量可忽略）。
* nginx 用 `frontend:3000` 走 docker 网络，**不暴露 frontend 端口**；宿主只暴露 3000。
* 若 nginx 起不来：`disable` 一定能回到"frontend 直接发布 3000"的形态（脚本按此顺序执行）。
* 本方案不带 TLS/域名/证书；需要 HTTPS 时用 `docker-compose.prod.yml` + `deploy/nginx.prod.conf` 那套。

## 相关文件
* `docker-compose.nginx.yml`：override（nginx 服务 + `ports: !override []` 让 frontend 让出 3000）
* `deploy/nginx.minimal.conf`：最小反代配置（XFF 覆盖）
* `deploy/nginx-proxy.sh`：enable / disable / status

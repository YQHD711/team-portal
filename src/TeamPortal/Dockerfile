FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# 在容器内单次 publish 完成 restore+build(避免 Windows 主机 NuGet fallback 路径泄露到 Linux 容器)
# 层缓存收益:obj/ 不进镜像层,源文件不变也不重 build,但镜像内是冷启动,镜像外是热缓存
COPY . .
RUN dotnet publish TeamPortal.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN sed -i 's@http://archive.ubuntu.com@http://mirrors.aliyun.com@g; s@http://security.ubuntu.com@http://mirrors.aliyun.com@g' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl git \
    && rm -rf /var/lib/apt/lists/*

# 非 root 用户(审计 #3) — 幂等:基础镜像若已有同名用户/组会 skip
RUN groupadd --force -r app 2>/dev/null || true \
    && id -u app >/dev/null 2>&1 || useradd -r -g app -d /app -s /sbin/nologin app

COPY --from=build /app .
RUN chown -R app:app /app
USER app

EXPOSE 8080
ENTRYPOINT ["dotnet", "TeamPortal.dll"]

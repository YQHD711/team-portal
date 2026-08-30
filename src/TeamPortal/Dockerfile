FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# 性能 #11:Dockerfile 分层缓存 — csproj 先拷贝 → restore → 源码
# 仅源码变更不重做 NuGet restore(冷启动 ~1-3min 节省)
COPY src/TeamPortal/*.csproj ./src/TeamPortal/
RUN dotnet restore src/TeamPortal/TeamPortal.csproj

COPY . .
RUN dotnet publish src/TeamPortal/TeamPortal.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# 非 root 用户(审计 #3)
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

COPY --from=build /app .
RUN chown -R app:app /app
USER app

EXPOSE 8080
ENTRYPOINT ["dotnet", "TeamPortal.dll"]

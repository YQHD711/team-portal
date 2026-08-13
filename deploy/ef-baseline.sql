-- ============================================================================
-- EF Core Migrations baseline 脚本（方式 A：仅登记 __EFMigrationsHistory，不执行建表 SQL）
-- 用途：项目 2026-08 从 EnsureCreated 切换到 EF Migrations。已有生产库由 EnsureCreated
--       建表且无 __EFMigrationsHistory 表，直接跑 Migrate() 会因 InitialCreate 建表语句
--       撞上已存在的表而失败。本脚本在历史库中登记 InitialCreate 已应用，Migrate() 将
--       跳过 InitialCreate，后续新增迁移正常生效。
--
-- 执行前（数据安全第一）：
--   1. 备份 teamportal.db 及 -wal/-shm 三个文件
--   2. 先在备份副本上执行本脚本 + 启动后端验证通过后，再对生产库执行
-- 幂等性：重复执行安全（先 DELETE 再 INSERT，防止主键冲突）
-- 执行方式（任选其一）：
--   sqlite3 teamportal.db < ef-baseline.sql
--   python -c "import sqlite3; con=sqlite3.connect('teamportal.db'); con.executescript(open('ef-baseline.sql').read()); con.commit()"
-- ============================================================================

-- 与 InitialCreate 迁移的 MigrationId 对应（src/TeamPortal/Migrations/ 文件名前缀）
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY,
    "ProductVersion" TEXT NOT NULL
);

DELETE FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260813155118_InitialCreate';
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260813155118_InitialCreate', '10.0.9');

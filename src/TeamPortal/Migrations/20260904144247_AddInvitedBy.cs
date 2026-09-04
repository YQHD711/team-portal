#nullable disable

using Microsoft.EntityFrameworkCore.Migrations;

// 精简版迁移：仅添加 Users.InvitedByUserId 及相关索引。
// 说明：原始生成版本包含多列(WikiTasks/Notifications/IncidentRecords)，
// 但这些列在历史运维中已手动加到库里，执行会报 duplicate column。
// 同时省略 FK 约束(SQLite 需整表重建，风险大且查询用不到)，导航属性照常工作。

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddInvitedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "InvitedByUserId",
                table: "Users",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_InvitedByUserId",
                table: "Users",
                column: "InvitedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_InviteCodes_CreatedByUserId",
                table: "InviteCodes",
                column: "CreatedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_InvitedByUserId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_InviteCodes_CreatedByUserId",
                table: "InviteCodes");

            migrationBuilder.DropColumn(
                name: "InvitedByUserId",
                table: "Users");
        }
    }
}

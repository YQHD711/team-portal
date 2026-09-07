using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddWeChatAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "WeChatBoundAt",
                table: "Users",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WeChatOpenId",
                table: "Users",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WeChatUnionId",
                table: "Users",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_WeChatOpenId",
                table: "Users",
                column: "WeChatOpenId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_WeChatUnionId",
                table: "Users",
                column: "WeChatUnionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_WeChatOpenId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Users_WeChatUnionId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeChatBoundAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeChatOpenId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeChatUnionId",
                table: "Users");
        }
    }
}

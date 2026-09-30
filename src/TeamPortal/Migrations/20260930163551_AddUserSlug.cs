using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddUserSlug : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Slug",
                table: "Users",
                type: "TEXT",
                maxLength: 40,
                nullable: true);

            // 回填老用户：不回填的话，现存账号的档案链接会直接失效。
            // SQLite 的 randomblob + hex 就够（64 bit 随机，队内规模碰撞概率可忽略），
            // 顺序放在建唯一索引之前 —— 万一真撞了，建索引时会立刻报出来而不是留个坏数据。
            migrationBuilder.Sql(
                "UPDATE Users SET Slug = 'u_' || lower(hex(randomblob(8))) WHERE Slug IS NULL OR Slug = '';");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Slug",
                table: "Users",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_Slug",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Slug",
                table: "Users");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddSessionTokenVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "UserTokenVersion",
                table: "DeviceSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserTokenVersion",
                table: "DeviceSessions");
        }
    }
}

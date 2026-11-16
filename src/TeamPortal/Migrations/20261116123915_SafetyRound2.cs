using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class SafetyRound2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Method",
                table: "DeviceSessions",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "AuthMethod",
                table: "BatteryLoans",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Method",
                table: "DeviceSessions");

            migrationBuilder.DropColumn(
                name: "AuthMethod",
                table: "BatteryLoans");
        }
    }
}

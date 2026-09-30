using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryCodeDropProjectTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ProjectTag",
                table: "InventoryItems");

            migrationBuilder.AddColumn<string>(
                name: "Code",
                table: "InventoryItems",
                type: "TEXT",
                maxLength: 60,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_InventoryItems_Code",
                table: "InventoryItems",
                column: "Code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_InventoryItems_Code",
                table: "InventoryItems");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "InventoryItems");

            migrationBuilder.AddColumn<string>(
                name: "ProjectTag",
                table: "InventoryItems",
                type: "TEXT",
                maxLength: 100,
                nullable: true);
        }
    }
}

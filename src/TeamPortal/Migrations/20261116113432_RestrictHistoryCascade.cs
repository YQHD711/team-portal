using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class RestrictHistoryCascade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BatteryLoans_BatteryItems_BatteryId",
                table: "BatteryLoans");

            migrationBuilder.DropForeignKey(
                name: "FK_CheckoutRequests_InventoryItems_InventoryItemId",
                table: "CheckoutRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_CheckoutRequests_Users_RequesterUserId",
                table: "CheckoutRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_DamageReports_InventoryItems_InventoryItemId",
                table: "DamageReports");

            migrationBuilder.DropForeignKey(
                name: "FK_DamageReports_Users_UserId",
                table: "DamageReports");

            migrationBuilder.DropForeignKey(
                name: "FK_InventoryTransactions_InventoryItems_InventoryItemId",
                table: "InventoryTransactions");

            migrationBuilder.DropForeignKey(
                name: "FK_StocktakeItems_InventoryItems_InventoryItemId",
                table: "StocktakeItems");

            migrationBuilder.AddForeignKey(
                name: "FK_BatteryLoans_BatteryItems_BatteryId",
                table: "BatteryLoans",
                column: "BatteryId",
                principalTable: "BatteryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_CheckoutRequests_InventoryItems_InventoryItemId",
                table: "CheckoutRequests",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_CheckoutRequests_Users_RequesterUserId",
                table: "CheckoutRequests",
                column: "RequesterUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_DamageReports_InventoryItems_InventoryItemId",
                table: "DamageReports",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_DamageReports_Users_UserId",
                table: "DamageReports",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_InventoryTransactions_InventoryItems_InventoryItemId",
                table: "InventoryTransactions",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StocktakeItems_InventoryItems_InventoryItemId",
                table: "StocktakeItems",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BatteryLoans_BatteryItems_BatteryId",
                table: "BatteryLoans");

            migrationBuilder.DropForeignKey(
                name: "FK_CheckoutRequests_InventoryItems_InventoryItemId",
                table: "CheckoutRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_CheckoutRequests_Users_RequesterUserId",
                table: "CheckoutRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_DamageReports_InventoryItems_InventoryItemId",
                table: "DamageReports");

            migrationBuilder.DropForeignKey(
                name: "FK_DamageReports_Users_UserId",
                table: "DamageReports");

            migrationBuilder.DropForeignKey(
                name: "FK_InventoryTransactions_InventoryItems_InventoryItemId",
                table: "InventoryTransactions");

            migrationBuilder.DropForeignKey(
                name: "FK_StocktakeItems_InventoryItems_InventoryItemId",
                table: "StocktakeItems");

            migrationBuilder.AddForeignKey(
                name: "FK_BatteryLoans_BatteryItems_BatteryId",
                table: "BatteryLoans",
                column: "BatteryId",
                principalTable: "BatteryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_CheckoutRequests_InventoryItems_InventoryItemId",
                table: "CheckoutRequests",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_CheckoutRequests_Users_RequesterUserId",
                table: "CheckoutRequests",
                column: "RequesterUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DamageReports_InventoryItems_InventoryItemId",
                table: "DamageReports",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DamageReports_Users_UserId",
                table: "DamageReports",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_InventoryTransactions_InventoryItems_InventoryItemId",
                table: "InventoryTransactions",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_StocktakeItems_InventoryItems_InventoryItemId",
                table: "StocktakeItems",
                column: "InventoryItemId",
                principalTable: "InventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}

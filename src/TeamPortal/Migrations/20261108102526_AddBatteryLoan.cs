using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddBatteryLoan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BatteryItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    Model = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Health = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    CurrentBorrowerId = table.Column<int>(type: "INTEGER", nullable: true),
                    BorrowedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BatteryItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BatteryItems_Users_CurrentBorrowerId",
                        column: x => x.CurrentBorrowerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "BatteryLoans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    BatteryId = table.Column<int>(type: "INTEGER", nullable: false),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    BorrowedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ReturnedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ReturnedByUserId = table.Column<int>(type: "INTEGER", nullable: true),
                    Note = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BatteryLoans", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BatteryLoans_BatteryItems_BatteryId",
                        column: x => x.BatteryId,
                        principalTable: "BatteryItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BatteryLoans_Users_ReturnedByUserId",
                        column: x => x.ReturnedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BatteryLoans_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BatteryItems_Code",
                table: "BatteryItems",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BatteryItems_CurrentBorrowerId",
                table: "BatteryItems",
                column: "CurrentBorrowerId");

            migrationBuilder.CreateIndex(
                name: "IX_BatteryLoans_BatteryId",
                table: "BatteryLoans",
                column: "BatteryId");

            migrationBuilder.CreateIndex(
                name: "IX_BatteryLoans_BorrowedAt",
                table: "BatteryLoans",
                column: "BorrowedAt");

            migrationBuilder.CreateIndex(
                name: "IX_BatteryLoans_ReturnedByUserId",
                table: "BatteryLoans",
                column: "ReturnedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_BatteryLoans_UserId_ReturnedAt",
                table: "BatteryLoans",
                columns: new[] { "UserId", "ReturnedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BatteryLoans");

            migrationBuilder.DropTable(
                name: "BatteryItems");
        }
    }
}

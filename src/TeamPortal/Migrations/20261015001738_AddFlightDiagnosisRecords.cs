using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddFlightDiagnosisRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FlightDiagnosisRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    SizeBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    Records = table.Column<long>(type: "INTEGER", nullable: false),
                    SkippedBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    DurationSec = table.Column<double>(type: "REAL", nullable: false),
                    Vehicle = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    VehicleKind = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    FirmwareVersion = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    VersionNumeric = table.Column<int>(type: "INTEGER", nullable: false),
                    ParseMs = table.Column<int>(type: "INTEGER", nullable: false),
                    AnalyzeMs = table.Column<int>(type: "INTEGER", nullable: false),
                    DecodedTypes = table.Column<int>(type: "INTEGER", nullable: false),
                    TotalTypes = table.Column<int>(type: "INTEGER", nullable: false),
                    Critical = table.Column<int>(type: "INTEGER", nullable: false),
                    Warning = table.Column<int>(type: "INTEGER", nullable: false),
                    Passed = table.Column<int>(type: "INTEGER", nullable: false),
                    Unknown = table.Column<int>(type: "INTEGER", nullable: false),
                    WarningsJson = table.Column<string>(type: "TEXT", nullable: false),
                    FindingsJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FlightDiagnosisRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FlightDiagnosisRecords_CreatedAt",
                table: "FlightDiagnosisRecords",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_FlightDiagnosisRecords_CreatedByUserId_CreatedAt",
                table: "FlightDiagnosisRecords",
                columns: new[] { "CreatedByUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_FlightDiagnosisRecords_FileName",
                table: "FlightDiagnosisRecords",
                column: "FileName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FlightDiagnosisRecords");
        }
    }
}

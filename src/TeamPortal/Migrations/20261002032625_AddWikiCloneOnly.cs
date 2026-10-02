using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeamPortal.Migrations
{
    /// <inheritdoc />
    public partial class AddWikiCloneOnly : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CloneOnly",
                table: "WikiTasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CloneOnly",
                table: "WikiTasks");
        }
    }
}

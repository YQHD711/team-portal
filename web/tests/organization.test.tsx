import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrgTab } from "@/components/admin/organization/OrgTab";
import type { Dept, OrgUser } from "@/components/admin/organization/types";

const dept1: Dept = { id: 1, name: "飞训部", description: "飞行训练", createdAt: "2026-01-01T00:00:00Z" };
const dept2: Dept = { id: 2, name: "电训部", description: "", createdAt: "2026-01-01T00:00:00Z" };
const member: OrgUser = { id: 4, username: "测试队员", role: "member", department: "飞训部", departmentId: 1, createdAt: "2026-01-01T00:00:00Z" };

function renderTab(isAdmin: boolean, ownDeptId: number | null, depts: Dept[], users: OrgUser[]) {
  return render(
    <OrgTab users={users} depts={depts} isAdmin={isAdmin} ownDeptId={ownDeptId}
      passedCertsByUser={new Map()} examPassesByUser={new Map()} skillsByUser={new Map()} examsByDept={new Map()}
      onChanged={() => {}} />
  );
}

describe("组织架构按钮门禁", () => {
  it("部长只看本部门,无 添加/编辑/删除部门 与 添加/删除队员", () => {
    renderTab(false, 1, [dept1, dept2], [member]);

    expect(screen.getAllByText("飞训部").length).toBeGreaterThan(0);
    expect(screen.queryByText("电训部")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加部门" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加队员" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("删除")).not.toBeInTheDocument();
    // 本部门成员保留“编辑”(账号)入口
    expect(screen.getAllByTitle("编辑").length).toBeGreaterThan(0);
  });

  it("admin 显示部门/队员管理按钮", () => {
    renderTab(true, null, [dept1, dept2], [member]);

    expect(screen.getByRole("button", { name: "添加部门" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加队员" })).toBeInTheDocument();
    expect(screen.getAllByTitle("编辑").length).toBeGreaterThan(0);
  });
});

using Xunit;

namespace api;

/// <summary>
/// 独占执行的测试集合。
///
/// 为什么需要：本仓库的集成测试都是"起一个 WebApplicationFactory + 自己的 SQLite 文件"，
/// 单跑各自都绿，但**并行跑全量**时会互相干扰 —— 实测表现为：
///  - 我的新测试类与既有 `CommitteeDepartmentTests` 一起红（`UNIQUE constraint failed: Users.Id/Username`、
///    依赖启动种子的查询拿到空集）；
///  - 失败清单每次运行都不一样（典型的时序/资源竞争，而不是数据写错）。
///
/// `DisableParallelization = true` 让集合内的类**独占**执行（不与其它集合并行），
/// 用一点时间换确定性。三个新增类（IP 信任 / 布局并发 / 在线状态）都起多个 host，最适合放在这里。
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public class SerializedCollection
{
    public const string Name = "serialized";
}

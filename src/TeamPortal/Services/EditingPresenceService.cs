using System.Collections.Concurrent;

namespace TeamPortal.Services;

/// <summary>
/// 「谁正在编辑房间 X」的在线状态（内存态，TTL 心跳）。
///
/// 为什么不上 WebSocket：这个场景只需要"有人/没人"这一个信号，轮询 + 心跳完全够用，
/// 而 WebSocket 会引入长连接、断线重连与部署复杂度。
///
/// 关键点：**心跳必须会自动过期**。否则用户关掉页面后那条"某某正在编辑"会永远挂着，
/// 变成幽灵编辑者，比不显示还糟。TTL 默认 30s（前端约每 10s 心跳一次 → 连丢 3 次才算离线）。
/// </summary>
public sealed class EditingPresenceService
{
    /// <summary>默认 TTL：30 秒（前端心跳间隔建议 10s）</summary>
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromSeconds(30);

    private readonly TimeSpan _ttl;
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<int, EditorState>> _rooms = new();

    public EditingPresenceService() : this(DefaultTtl) { }

    public EditingPresenceService(TimeSpan ttl) => _ttl = ttl > TimeSpan.Zero ? ttl : DefaultTtl;

    public TimeSpan Ttl => _ttl;

    public sealed record EditorState(int UserId, string Name, DateTime SinceUtc, DateTime ExpiresAtUtc);

    /// <summary>记录一次心跳并返回**当前仍在线**的编辑者（已过期的会被顺手清掉）</summary>
    public IReadOnlyList<EditorState> Heartbeat(int roomId, int userId, string name, DateTime? nowUtc = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
        var room = _rooms.GetOrAdd(roomId, _ => new ConcurrentDictionary<int, EditorState>());
        var since = room.TryGetValue(userId, out var existing) ? existing.SinceUtc : now;
        room[userId] = new EditorState(userId, name, since, now.Add(_ttl));
        return Editors(roomId, now);
    }

    /// <summary>当前在线编辑者（已过期的不返回，并从内存里删除）</summary>
    public IReadOnlyList<EditorState> Editors(int roomId, DateTime? nowUtc = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
        if (!_rooms.TryGetValue(roomId, out var room)) return Array.Empty<EditorState>();

        foreach (var (userId, state) in room)
        {
            if (state.ExpiresAtUtc <= now) room.TryRemove(userId, out _);
        }
        if (room.IsEmpty)
        {
            _rooms.TryRemove(roomId, out _);
            return Array.Empty<EditorState>();
        }
        return room.Values.OrderBy(e => e.SinceUtc).ToList();
    }

    /// <summary>离开页面 / 保存成功后立刻清除自己（不用等 TTL）</summary>
    public bool Leave(int roomId, int userId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return false;
        var removed = room.TryRemove(userId, out _);
        if (room.IsEmpty) _rooms.TryRemove(roomId, out _);
        return removed;
    }

    /// <summary>房间被删除等场景整体清理</summary>
    public void Clear(int roomId) => _rooms.TryRemove(roomId, out _);
}

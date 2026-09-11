namespace TeamPortal.Services;

/// <summary>
/// 边下边转的缓存流：把上游字节同时写给客户端和本地 .part 文件。
/// 只有完整读完才原子改名发布 —— 半截文件绝不进缓存（固件刷写，坏文件代价高）；
/// 客户端中途断开则丢弃 .part，不留垃圾也不污染缓存。
/// </summary>
public sealed class FirmwareCachingStream : Stream
{
    private readonly Stream _inner;
    private readonly IDisposable? _owner;
    private readonly string _tempPath;
    private readonly string _finalPath;
    private readonly long _maxBytes;
    private readonly LogService _log;

    private FileStream? _file;
    private long _written;
    private bool _completed;
    private bool _disposed;

    public FirmwareCachingStream(Stream inner, IDisposable? owner, string tempPath, string finalPath, long maxBytes, LogService log)
    {
        _inner = inner;
        _owner = owner;
        _tempPath = tempPath;
        _finalPath = finalPath;
        _maxBytes = maxBytes;
        _log = log;
    }

    /// <summary>已向下游交付的字节数。</summary>
    public long Written => _written;

    /// <summary>是否完整读完并已发布到缓存。</summary>
    public bool Completed => _completed;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => _written; set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = _inner.Read(buffer, offset, count);
        if (read > 0) Append(buffer.AsSpan(offset, read));
        else Complete();
        return read;
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await _inner.ReadAsync(buffer, cancellationToken);
        if (read > 0) Append(buffer.Span[..read]);
        else Complete();
        return read;
    }

    private void Append(ReadOnlySpan<byte> data)
    {
        _written += data.Length;
        if (_written > _maxBytes)
            throw new IOException($"固件体积超过上限 {_maxBytes} 字节，已中止");

        _file ??= File.Create(_tempPath);
        _file.Write(data);
    }

    /// <summary>读到流末尾：落盘 + 原子改名。发布失败只记日志，不影响已经交付给客户端的字节。</summary>
    private void Complete()
    {
        if (_completed) return;
        _completed = true;
        try
        {
            _file?.Flush();
            _file?.Dispose();
            _file = null;
            if (_written == 0) { TryDelete(_tempPath); return; }
            File.Move(_tempPath, _finalPath, overwrite: true);
            _log.Info("firmware", $"Cached firmware {Path.GetFileName(_finalPath)} ({_written} bytes)");
        }
        catch (Exception ex)
        {
            _log.Warn("firmware", $"Failed to publish cache for {Path.GetFileName(_finalPath)}: {ex.Message}");
            TryDelete(_tempPath);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (_disposed)
        {
            base.Dispose(disposing);
            return;
        }
        _disposed = true;
        if (disposing)
        {
            try { _file?.Dispose(); } catch { /* 尽力清理 */ }
            _file = null;
            if (!_completed)
            {
                TryDelete(_tempPath);
                _log.Warn("firmware", $"Download interrupted, discarded partial cache for {Path.GetFileName(_finalPath)} ({_written} bytes)");
            }
            try { _inner.Dispose(); } catch { /* 上游流释放失败无所谓 */ }
            _owner?.Dispose();
        }
        base.Dispose(disposing);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* 尽力清理 */ }
    }
}

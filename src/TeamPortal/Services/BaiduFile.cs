namespace TeamPortal.Services;

/// <summary>百度网盘文件条目（xpan file?method=list / filemetas 返回结构）。</summary>
public class BaiduFile
{
    [System.Text.Json.Serialization.JsonPropertyName("fsId")]
    public long FsId { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("path")]
    public string Path { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string FileName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("size")]
    public long Size { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("isDir")]
    public bool IsDir { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("modified")]
    public long ModifyTime { get; set; }
}

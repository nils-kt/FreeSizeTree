namespace FreeSizeTree;

/// <summary>A scanned folder. Sizes include all subfolders once the scan has been aggregated.</summary>
sealed class DirNode(string name, DirNode? parent)
{
    public string Name = name;
    public DirNode? Parent = parent;
    public List<DirNode>? Children;      // sorted by Size, descending
    public List<FileEntry>? BigFiles;    // own files >= Scanner.BigFileThreshold, sorted by Size
    public long Size;                    // total bytes (subtree)
    public long OwnFilesSize;            // bytes of files directly in this folder
    public int OwnFileCount;
    public long FileCount;               // files in subtree
    public long DirCount;                // folders in subtree
    public int SkippedLinks;             // junctions / symlinks not followed
    public DateTime LastWriteUtc;        // newest file in subtree
    public bool AccessDenied;

    public string FullPath => Parent == null ? Name : Path.Join(Parent.FullPath, Name);

    public bool IsWithin(DirNode ancestor)
    {
        for (var d = this; d != null; d = d.Parent)
            if (d == ancestor) return true;
        return false;
    }
}

sealed class FileEntry(string name, long size, DateTime lastWriteUtc, DirNode parent)
{
    public string Name { get; } = name;
    public long Size { get; } = size;
    public DateTime LastWriteUtc { get; } = lastWriteUtc;
    public DirNode Parent { get; } = parent;
    public string FullPath => Path.Join(Parent.FullPath, Name);
    public string Extension => Path.GetExtension(Name).ToLowerInvariant();
}

/// <summary>All files of a folder that are too small to be tracked individually.</summary>
sealed record RestBlock(DirNode Dir, long Size, int Count);

sealed class ExtStat
{
    public long Bytes;
    public long Count;
}

static class Items
{
    public static string PathOf(object? item) => item switch
    {
        DirNode d => d.FullPath,
        FileEntry f => f.FullPath,
        RestBlock r => r.Dir.FullPath,
        _ => "",
    };

    public static long SizeOf(object? item) => item switch
    {
        DirNode d => d.Size,
        FileEntry f => f.Size,
        RestBlock r => r.Size,
        _ => 0,
    };

    public static string NameOf(object? item) => item switch
    {
        DirNode d => d.Name,
        FileEntry f => f.Name,
        RestBlock r => $"{Fmt.Num(r.Count)} kleinere Dateien",
        _ => "",
    };

    public static List<FileEntry> LargestFiles(DirNode root, int count)
    {
        var pq = new PriorityQueue<FileEntry, long>();
        var stack = new Stack<DirNode>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            if (d.BigFiles != null)
                foreach (var f in d.BigFiles)
                {
                    if (pq.Count < count) pq.Enqueue(f, f.Size);
                    else if (f.Size > pq.Peek().Size) pq.EnqueueDequeue(f, f.Size);
                }
            if (d.Children != null)
                foreach (var c in d.Children) stack.Push(c);
        }
        var list = pq.UnorderedItems.Select(x => x.Element).ToList();
        list.Sort((a, b) => b.Size.CompareTo(a.Size));
        return list;
    }
}

/// <summary>Keeps aggregated sizes consistent when the tree changes after a scan.</summary>
static class TreeOps
{
    public static void Propagate(DirNode? start, long dSize, long dFiles, long dDirs)
    {
        for (var n = start; n != null; n = n.Parent)
        {
            n.Size += dSize;
            n.FileCount += dFiles;
            n.DirCount += dDirs;
            n.Children?.Sort((a, b) => b.Size.CompareTo(a.Size));
        }
    }

    public static void RemoveDir(DirNode d)
    {
        if (d.Parent is not { } p) return;
        p.Children?.Remove(d);
        Propagate(p, -d.Size, -d.FileCount, -(d.DirCount + 1));
    }

    public static void RemoveFile(FileEntry f)
    {
        var p = f.Parent;
        p.BigFiles?.Remove(f);
        p.OwnFilesSize -= f.Size;
        p.OwnFileCount--;
        Propagate(p, -f.Size, -1, 0);
    }

    /// <summary>Puts a freshly scanned subtree in place of an old one.</summary>
    public static void Replace(DirNode old, DirNode fresh)
    {
        if (old.Parent is not { } p || p.Children is null) return;
        int i = p.Children.IndexOf(old);
        if (i < 0) return;
        fresh.Name = old.Name;
        fresh.Parent = p;
        p.Children[i] = fresh;
        Propagate(p, fresh.Size - old.Size, fresh.FileCount - old.FileCount, fresh.DirCount - old.DirCount);
    }

    /// <summary>Finds the node for a path inside the scanned tree, or null.</summary>
    public static DirNode? Find(DirNode root, string path)
    {
        string rp = root.FullPath;
        try { path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)); } catch { return null; }
        string basePath = Path.TrimEndingDirectorySeparator(rp); // a drive root keeps its "\"
        if (!path.StartsWith(basePath, StringComparison.OrdinalIgnoreCase)) return null;
        string rest = path[basePath.Length..];
        if (rest.Length > 0 && rest[0] != '\\' && !basePath.EndsWith('\\')) return null;
        var d = root;
        foreach (var seg in rest.Split('\\', StringSplitOptions.RemoveEmptyEntries))
        {
            var next = d.Children?.FirstOrDefault(c => c.Name.Equals(seg, StringComparison.OrdinalIgnoreCase));
            if (next == null) return null;
            d = next;
        }
        return d;
    }
}

static class Fmt
{
    static readonly string[] Units = ["KB", "MB", "GB", "TB", "PB"];

    public static string Size(long bytes)
    {
        if (bytes < 0) return "-" + Size(-bytes);
        if (bytes < 1024) return $"{bytes} B";
        double v = bytes;
        int i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < Units.Length - 1);
        return v >= 100 ? $"{v:0} {Units[i]}" : v >= 10 ? $"{v:0.0} {Units[i]}" : $"{v:0.00} {Units[i]}";
    }

    public static string Num(long n) => n.ToString("N0");

    public static string Date(DateTime utc) => utc == default ? "" : utc.ToLocalTime().ToString("g");
}

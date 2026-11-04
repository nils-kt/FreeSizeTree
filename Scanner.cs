using System.Collections.Concurrent;
using System.IO.Enumeration;

namespace FreeSizeTree;

/// <summary>
/// Multithreaded folder scanner. Each worker pops a folder, enumerates it once (files are
/// accounted in place without allocating objects for small files) and pushes the subfolders.
/// </summary>
sealed class Scanner
{
    public const long BigFileThreshold = 1L << 20; // files >= 1 MB are kept individually
    const int CloudMask = 0x00400000 | 0x00040000;  // RECALL_ON_DATA_ACCESS | RECALL_ON_OPEN (OneDrive "online only")

    public long Files, Bytes, Dirs, Errors, CloudBytes;
    public volatile string Current = "";
    public bool Cancelled { get; private set; }
    public Dictionary<string, ExtStat> Extensions { get; } = new(StringComparer.OrdinalIgnoreCase);

    static readonly EnumerationOptions Options = new()
    {
        RecurseSubdirectories = false,
        IgnoreInaccessible = false,   // we want ContinueOnError to see access-denied folders
        AttributesToSkip = 0,         // include hidden and system files
        ReturnSpecialDirectories = false,
    };

    readonly ConcurrentStack<DirNode> stack = new();
    readonly SemaphoreSlim available = new(0);
    int pending;
    volatile bool done;
    int threadCount;

    public DirNode Scan(string path, CancellationToken ct)
    {
        path = Path.GetFullPath(path);
        if (path.Length > 3) path = Path.TrimEndingDirectorySeparator(path);
        var root = new DirNode(path, null);

        stack.Push(root);
        pending = 1;
        available.Release();

        threadCount = Math.Clamp(Environment.ProcessorCount, 4, 16);
        var workers = new Thread[threadCount];
        for (int i = 0; i < workers.Length; i++)
        {
            workers[i] = new Thread(() => Work(ct)) { IsBackground = true, Name = "scan" + i };
            workers[i].Start();
        }
        foreach (var w in workers) w.Join();

        Cancelled = ct.IsCancellationRequested && !done;
        Aggregate(root);
        return root;
    }

    void Work(CancellationToken ct)
    {
        var ext = new Dictionary<string, ExtStat>(StringComparer.OrdinalIgnoreCase);
        try
        {
            while (true)
            {
                available.Wait(ct);
                if (done) break;
                if (!stack.TryPop(out var dir)) continue;

                Process(dir, ext);

                if (dir.Children is { Count: > 0 } kids)
                {
                    Interlocked.Add(ref pending, kids.Count);
                    stack.PushRange(kids.ToArray());
                    available.Release(kids.Count);
                }
                if (Interlocked.Decrement(ref pending) == 0)
                {
                    done = true;
                    available.Release(threadCount);
                }
            }
        }
        catch (OperationCanceledException) { }

        lock (Extensions)
            foreach (var (key, st) in ext)
            {
                if (!Extensions.TryGetValue(key, out var total)) Extensions[key] = total = new ExtStat();
                total.Bytes += st.Bytes;
                total.Count += st.Count;
            }
    }

    void Process(DirNode dir, Dictionary<string, ExtStat> ext)
    {
        string path = dir.FullPath;
        Current = path;
        DirEnumerator? en = null;
        try
        {
            en = new DirEnumerator(path, dir, ext);
            while (en.MoveNext())
                (dir.Children ??= []).Add(new DirNode(en.Current, dir));
            if (en.Error != 0)
            {
                dir.AccessDenied = en.Error == 5;
                Interlocked.Increment(ref Errors);
            }
            if (en.CloudBytes > 0) Interlocked.Add(ref CloudBytes, en.CloudBytes);
        }
        catch
        {
            dir.AccessDenied = true;
            Interlocked.Increment(ref Errors);
        }
        finally
        {
            en?.Dispose();
        }
        Interlocked.Add(ref Files, dir.OwnFileCount);
        Interlocked.Add(ref Bytes, dir.OwnFilesSize);
        Interlocked.Increment(ref Dirs);
    }

    /// <summary>Rolls sizes up the tree (children before parents) and sorts everything by size.</summary>
    public static void Aggregate(DirNode root)
    {
        var order = new List<DirNode> { root };
        for (int i = 0; i < order.Count; i++)
            if (order[i].Children != null) order.AddRange(order[i].Children!);

        for (int i = order.Count - 1; i >= 0; i--)
        {
            var n = order[i];
            n.Size += n.OwnFilesSize;
            n.FileCount += n.OwnFileCount;
            n.Children?.Sort((a, b) => b.Size.CompareTo(a.Size));
            n.BigFiles?.Sort((a, b) => b.Size.CompareTo(a.Size));
            if (n.Parent is { } p)
            {
                p.Size += n.Size;
                p.FileCount += n.FileCount;
                p.DirCount += n.DirCount + 1;
                if (n.LastWriteUtc > p.LastWriteUtc) p.LastWriteUtc = n.LastWriteUtc;
            }
        }
    }

    public static bool IsCloudOnly(FileAttributes attr) =>
        ((int)attr & CloudMask) != 0 || (attr & FileAttributes.Offline) != 0;

    sealed class DirEnumerator : FileSystemEnumerator<string>
    {
        readonly DirNode node;
        readonly Dictionary<string, ExtStat>.AlternateLookup<ReadOnlySpan<char>> ext;
        public int Error;
        public long CloudBytes;

        public DirEnumerator(string directory, DirNode node, Dictionary<string, ExtStat> ext)
            : base(directory, Options)
        {
            this.node = node;
            this.ext = ext.GetAlternateLookup<ReadOnlySpan<char>>();
        }

        protected override bool ShouldIncludeEntry(ref FileSystemEntry entry)
        {
            var attr = entry.Attributes;
            if (entry.IsDirectory)
            {
                // Do not follow junctions / symlinks (would double count), but do enter
                // other reparse points such as OneDrive folders.
                if ((attr & FileAttributes.ReparsePoint) != 0 && IsLink(entry.ToFullPath()))
                {
                    node.SkippedLinks++;
                    return false;
                }
                return true;
            }

            long len = entry.Length;
            if (IsCloudOnly(attr))
            {
                CloudBytes += len;
                len = 0; // occupies no local disk space
            }
            node.OwnFileCount++;
            node.OwnFilesSize += len;
            var lw = entry.LastWriteTimeUtc.UtcDateTime;
            if (lw > node.LastWriteUtc) node.LastWriteUtc = lw;

            var name = entry.FileName;
            int dot = name.LastIndexOf('.');
            var e = dot >= 0 && dot < name.Length - 1 ? name[(dot + 1)..] : [];
            if (!ext.TryGetValue(e, out var st))
            {
                st = new ExtStat();
                ext.TryAdd(e, st);
            }
            st.Bytes += len;
            st.Count++;

            if (len >= BigFileThreshold)
                (node.BigFiles ??= []).Add(new FileEntry(name.ToString(), len, lw, node));
            return false;
        }

        protected override string TransformEntry(ref FileSystemEntry entry) => entry.FileName.ToString();

        protected override bool ContinueOnError(int error)
        {
            Error = error;
            return true;
        }

        static bool IsLink(string path)
        {
            try { return new DirectoryInfo(path).LinkTarget != null; }
            catch { return true; }
        }
    }
}

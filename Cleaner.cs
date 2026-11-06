namespace FreeSizeTree;

/// <summary>Live counters of a running cleanup, read by the UI timer.</summary>
sealed class CleanProgress
{
    public long Freed;
    public long Files;
    public volatile string? Current;
}

/// <summary>Robust permanent deletion that skips files in use instead of failing.</summary>
static class Cleaner
{
    static readonly EnumerationOptions All = new() { AttributesToSkip = 0, IgnoreInaccessible = true, RecurseSubdirectories = false };

    /// <summary>Deletes everything inside a folder but keeps the folder. Returns freed bytes.</summary>
    public static long DeleteContents(string dir, CleanProgress? p = null, CancellationToken ct = default)
    {
        long freed = 0;
        DirectoryInfo di;
        try { di = new DirectoryInfo(dir); if (!di.Exists) return 0; } catch { return 0; }
        foreach (var e in SafeList(di))
        {
            if (ct.IsCancellationRequested) break;
            if (e is DirectoryInfo sub) freed += DeleteTree(sub.FullName, p, ct);
            else if (e is FileInfo f) freed += DeleteFile(f, p);
        }
        return freed;
    }

    /// <summary>Deletes a folder with all contents. Returns freed bytes.</summary>
    public static long DeleteTree(string dir, CleanProgress? p = null, CancellationToken ct = default)
    {
        long freed = 0;
        try
        {
            var di = new DirectoryInfo(dir);
            if (!di.Exists) return 0;
            if (di.LinkTarget != null) { di.Delete(false); return 0; } // junction: remove the link only
            foreach (var e in SafeList(di))
            {
                if (ct.IsCancellationRequested) return freed;
                if (e is DirectoryInfo sub) freed += DeleteTree(sub.FullName, p, ct);
                else if (e is FileInfo f) freed += DeleteFile(f, p);
            }
            di.Attributes = FileAttributes.Normal;
            di.Delete(false);
        }
        catch { /* folder still contains files in use */ }
        return freed;
    }

    public static long DeleteFile(FileInfo f, CleanProgress? p = null)
    {
        try
        {
            long len = f.Length;
            if (p != null) p.Current = f.FullName;
            if ((f.Attributes & (FileAttributes.ReadOnly | FileAttributes.System | FileAttributes.Hidden)) != 0)
                f.Attributes = FileAttributes.Normal;
            f.Delete();
            if (p != null)
            {
                Interlocked.Add(ref p.Freed, len);
                Interlocked.Increment(ref p.Files);
            }
            return len;
        }
        catch { return 0; }
    }

    static List<FileSystemInfo> SafeList(DirectoryInfo di)
    {
        try { return di.EnumerateFileSystemInfos("*", All).ToList(); }
        catch { return []; }
    }
}

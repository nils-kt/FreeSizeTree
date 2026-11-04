namespace FreeSizeTree;

/// <summary>Robust permanent deletion that skips files in use instead of failing.</summary>
static class Cleaner
{
    static readonly EnumerationOptions All = new() { AttributesToSkip = 0, IgnoreInaccessible = true, RecurseSubdirectories = false };

    /// <summary>Deletes everything inside a folder but keeps the folder. Returns freed bytes.</summary>
    public static long DeleteContents(string dir)
    {
        long freed = 0;
        DirectoryInfo di;
        try { di = new DirectoryInfo(dir); if (!di.Exists) return 0; } catch { return 0; }
        foreach (var e in SafeList(di))
        {
            if (e is DirectoryInfo sub) freed += DeleteTree(sub.FullName);
            else if (e is FileInfo f) freed += DeleteFile(f);
        }
        return freed;
    }

    /// <summary>Deletes a folder with all contents. Returns freed bytes.</summary>
    public static long DeleteTree(string dir)
    {
        long freed = 0;
        try
        {
            var di = new DirectoryInfo(dir);
            if (!di.Exists) return 0;
            if (di.LinkTarget != null) { di.Delete(false); return 0; } // junction: remove the link only
            foreach (var e in SafeList(di))
            {
                if (e is DirectoryInfo sub) freed += DeleteTree(sub.FullName);
                else if (e is FileInfo f) freed += DeleteFile(f);
            }
            di.Attributes = FileAttributes.Normal;
            di.Delete(false);
        }
        catch { /* folder still contains files in use */ }
        return freed;
    }

    public static long DeleteFile(FileInfo f)
    {
        try
        {
            long len = f.Length;
            if ((f.Attributes & (FileAttributes.ReadOnly | FileAttributes.System | FileAttributes.Hidden)) != 0)
                f.Attributes = FileAttributes.Normal;
            f.Delete();
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

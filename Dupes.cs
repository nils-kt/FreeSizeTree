using System.Security.Cryptography;

namespace FreeSizeTree;

sealed class DupeGroup
{
    public long Size { get; init; }
    public bool Exact { get; init; }
    public required List<FileEntry> Files { get; init; }
    public long Wasted => Size * (Files.Count - 1);
}

/// <summary>
/// Duplicate finder for the files kept in the scan tree: group by size, then by a hash of
/// head/middle/tail, then by a full hash (or a dense sampled hash for very large files).
/// </summary>
static class DupeFinder
{
    const int Chunk = 64 * 1024;
    const long FullHashLimit = 512L << 20;

    public static List<DupeGroup> Find(DirNode root, long minSize, Action<int, int> progress, CancellationToken ct)
    {
        var bySize = new Dictionary<long, List<FileEntry>>();
        var stack = new Stack<DirNode>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            if (d.BigFiles != null)
                foreach (var f in d.BigFiles)
                    if (f.Size >= minSize)
                    {
                        if (!bySize.TryGetValue(f.Size, out var l)) bySize[f.Size] = l = [];
                        l.Add(f);
                    }
            if (d.Children != null)
                foreach (var c in d.Children)
                    if (c.Size >= minSize) stack.Push(c);
        }

        var candidates = bySize.Values.Where(l => l.Count > 1).ToList();
        int total = candidates.Sum(l => l.Count), done = 0;
        var result = new List<DupeGroup>();
        foreach (var group in candidates)
        {
            ct.ThrowIfCancellationRequested();
            long size = group[0].Size;
            var quick = new Dictionary<string, List<FileEntry>>();
            foreach (var f in group)
            {
                var h = Hash(f.FullPath, size, sampleOnly: true);
                progress(++done, total);
                if (h == null) continue;
                if (!quick.TryGetValue(h, out var l)) quick[h] = l = [];
                l.Add(f);
            }
            foreach (var sub in quick.Values.Where(l => l.Count > 1))
            {
                if (size > FullHashLimit)
                {
                    result.Add(new DupeGroup { Size = size, Exact = false, Files = sub });
                    continue;
                }
                var full = new Dictionary<string, List<FileEntry>>();
                foreach (var f in sub)
                {
                    ct.ThrowIfCancellationRequested();
                    var h = Hash(f.FullPath, size, sampleOnly: false);
                    if (h == null) continue;
                    if (!full.TryGetValue(h, out var l)) full[h] = l = [];
                    l.Add(f);
                }
                foreach (var same in full.Values.Where(l => l.Count > 1))
                    result.Add(new DupeGroup { Size = size, Exact = true, Files = same });
            }
        }
        result.Sort((a, b) => b.Wasted.CompareTo(a.Wasted));
        return result;
    }

    static string? Hash(string path, long size, bool sampleOnly)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20, FileOptions.SequentialScan);
            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buf = new byte[sampleOnly ? Chunk : 1 << 20];
            if (sampleOnly)
            {
                // 16 evenly spaced 64 KB samples incl. head and tail
                int samples = size <= Chunk * 16 ? 1 : 16;
                for (int i = 0; i < samples; i++)
                {
                    long pos = samples == 1 ? 0 : (size - Chunk) * i / (samples - 1);
                    fs.Position = pos;
                    int n = fs.ReadAtLeast(buf, (int)Math.Min(Chunk, size - pos), throwOnEndOfStream: false);
                    sha.AppendData(buf, 0, n);
                }
            }
            else
            {
                int n;
                while ((n = fs.Read(buf, 0, buf.Length)) > 0) sha.AppendData(buf, 0, n);
            }
            return Convert.ToHexString(sha.GetHashAndReset());
        }
        catch { return null; }
    }
}

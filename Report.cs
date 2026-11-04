using System.Diagnostics;
using System.Text;

namespace FreeSizeTree;

/// <summary>Plain-text summary of a scan, used by the --report command line mode.</summary>
static class Report
{
    public static void Write(string path, string outFile)
    {
        var sc = new Scanner();
        var sw = Stopwatch.StartNew();
        var root = sc.Scan(path, CancellationToken.None);
        sw.Stop();

        using var w = new StreamWriter(outFile, false, new UTF8Encoding(true));
        w.WriteLine($"FreeSizeTree-Bericht für {root.Name} – {DateTime.Now:g}");
        w.WriteLine($"Gesamt: {Fmt.Size(root.Size)} · {Fmt.Num(root.FileCount)} Dateien · {Fmt.Num(root.DirCount)} Ordner · " +
                    $"Scan {sw.Elapsed.TotalSeconds:0.0} s · {Fmt.Num(sc.Errors)} Ordner ohne Zugriff · nur Cloud: {Fmt.Size(sc.CloudBytes)}");
        try
        {
            var di = new DriveInfo(Path.GetPathRoot(root.Name)!);
            w.WriteLine($"Laufwerk {di.Name}: {Fmt.Size(di.TotalSize - di.TotalFreeSpace)} belegt, {Fmt.Size(di.AvailableFreeSpace)} frei von {Fmt.Size(di.TotalSize)}");
        }
        catch { }

        w.WriteLine();
        w.WriteLine("== Größte Ordner (ab 1 % der Gesamtgröße, 4 Ebenen) ==");
        long min = Math.Max(1, root.Size / 100);
        void Dump(DirNode d, int depth)
        {
            if (d.Children == null) return;
            foreach (var c in d.Children)
            {
                if (c.Size < min) break;
                w.WriteLine($"{new string(' ', depth * 2)}{Fmt.Size(c.Size),10}  {c.Name}{(c.AccessDenied ? "  [kein Zugriff]" : "")}");
                if (depth < 3) Dump(c, depth + 1);
            }
        }
        Dump(root, 0);

        w.WriteLine();
        w.WriteLine("== Größte Dateien ==");
        foreach (var f in Items.LargestFiles(root, 30))
            w.WriteLine($"{Fmt.Size(f.Size),10}  {f.FullPath}");

        w.WriteLine();
        w.WriteLine("== Dateitypen ==");
        foreach (var (ext, st) in sc.Extensions.OrderByDescending(kv => kv.Value.Bytes).Take(20))
            w.WriteLine($"{Fmt.Size(st.Bytes),10}  {(ext.Length == 0 ? "(ohne)" : "." + ext.ToLowerInvariant()),-14} {Fmt.Num(st.Count)} Dateien");

        w.WriteLine();
        w.WriteLine("== Aufräum-Tipps ==");
        foreach (var h in CleanupAdvisor.Analyze(root))
            w.WriteLine($"{Fmt.Size(h.Size),10}  [{CleanupAdvisor.Label(h.Safety)}] {h.Category}: {h.Path}");
    }
}

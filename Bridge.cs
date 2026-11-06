using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.VisualBasic.FileIO;
using Microsoft.Web.WebView2.Core;

namespace FreeSizeTree;

/// <summary>
/// Message based RPC between the web UI and the scanner. The page sends {id, cmd, args};
/// we answer {type:"reply", id, ok, result|error} and push {type:"event", ev, data}.
/// </summary>
sealed class Bridge
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    static readonly EnumerationOptions FileList = new() { AttributesToSkip = 0, IgnoreInaccessible = true };
    static readonly string[] AllowedSchemes = ["https", "steam", "com.epicgames.launcher", "goggalaxy", "uplay", "ms-settings"];

    readonly AppWindow win;
    readonly CoreWebView2 web;
    readonly StartOptions options;
    readonly System.Windows.Forms.Timer timer = new() { Interval = 150 };
    readonly Stopwatch clock = new();

    // object handles handed to the page
    readonly List<object> objs = [];
    readonly Dictionary<object, int> ids = new(ReferenceEqualityComparer.Instance);

    DirNode? root;
    Dictionary<string, ExtStat> extensions = [];
    List<Hint> hints = [];
    Scanner? scanner;
    CancellationTokenSource? scanCts, sizeCts, dupeCts, cleanCts;
    long estimate;
    bool busy, cleaning;
    (long errors, long cloud, double seconds, bool cancelled) lastScan;
    List<Game>? games;
    List<UninstallEntry>? apps;
    readonly DemoData? demo;

    // Everything that changes or opens something on the real system is refused in demo mode.
    static readonly HashSet<string> NotInDemo =
    [
        "pickFolder", "scan", "cancel", "clean", "autoClean", "delete", "rescan", "reveal", "open", "openUrl", "copy",
        "emptyRecycle", "uninstallGame", "uninstallApp", "elevate",
    ];

    // Hint actions that the cleanup dialog may run without further questions.
    static readonly HintAction[] AutoActions = [HintAction.EmptyRecycleBin, HintAction.CleanContents, HintAction.DeleteFolder, HintAction.DeleteFile];

    public Bridge(AppWindow win, CoreWebView2 web, StartOptions options)
    {
        this.win = win;
        this.web = web;
        this.options = options;
        timer.Tick += (_, _) => EmitProgress();
        if (options.Demo)
        {
            demo = new DemoData();
            root = demo.Root;
            extensions = demo.Extensions;
            hints = CleanupAdvisor.Analyze(root);
            lastScan = (0, 3_650_000_000, 41.7, false);
            games = demo.Games;
            apps = demo.Apps;
        }
    }

    public void Shutdown()
    {
        scanCts?.Cancel();
        sizeCts?.Cancel();
        dupeCts?.Cancel();
        cleanCts?.Cancel();
    }

    // ================================================================ plumbing

    public async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var m = doc.RootElement;
            id = m.GetProperty("id").GetInt32();
            string cmd = m.GetProperty("cmd").GetString() ?? "";
            var args = m.TryGetProperty("args", out var a) ? a.Clone() : default;
            var result = await Handle(cmd, args);
            Post(new { type = "reply", id, ok = true, result });
        }
        catch (Exception ex)
        {
            Post(new { type = "reply", id, ok = false, error = ex.Message });
        }
    }

    void Post(object message)
    {
        if (win.IsDisposed) return;
        string json = JsonSerializer.Serialize(message, Json);
        if (win.InvokeRequired) win.BeginInvoke(() => web.PostWebMessageAsJson(json));
        else web.PostWebMessageAsJson(json);
    }

    void Emit(string ev, object? data) => Post(new { type = "event", ev, data });

    static string Str(JsonElement a, string k) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    static long Num(JsonElement a, string k) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : 0;

    static bool Flag(JsonElement a, string k) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;

    static List<string> Strs(JsonElement a, string k) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : [];

    void EnsureIdle()
    {
        if (busy) throw new InvalidOperationException("Bitte warten, bis der Scan fertig ist.");
        if (cleaning) throw new InvalidOperationException("Bitte warten, bis die Bereinigung fertig ist.");
    }

    static Task<object?> Done(object? o) => Task.FromResult(o);

    int Id(object o)
    {
        if (!ids.TryGetValue(o, out var i))
        {
            i = objs.Count;
            objs.Add(o);
            ids[o] = i;
        }
        return i;
    }

    object Obj(long id) => id >= 0 && id < objs.Count ? objs[(int)id] : throw new InvalidOperationException("Element nicht mehr vorhanden – bitte neu scannen.");

    static long? Ms(DateTime utc) =>
        utc.Year < 1980 ? null : new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    Task<object?> Handle(string cmd, JsonElement a) => demo != null && NotInDemo.Contains(cmd)
        ? throw new InvalidOperationException("Im Demo-Modus nicht verfügbar.")
        : cmd switch
    {
        "init" => Done(Init()),
        "drives" => Done(demo?.Drives ?? Drives()),
        "pickFolder" => Done(PickFolder()),
        "scan" => Done(StartScan(Str(a, "path"))),
        "cancel" => Done(Cancel()),
        "summary" => Done(root == null ? null : Summary()),
        "node" => Done(NodeInfo(Num(a, "id"))),
        "chart" => Done(Chart(Num(a, "id"))),
        "types" => Done(Types()),
        "files" => Done(Files()),
        "hints" => Done(HintList()),
        "clean" => Clean(Str(a, "path")),
        "autoClean" => AutoClean(Strs(a, "paths")),
        "cancelClean" => Done(CancelClean()),
        "delete" => Delete(Num(a, "id"), Str(a, "mode")),
        "rescan" => Rescan(Num(a, "id")),
        "reveal" => Done(Reveal(Str(a, "path"))),
        "open" => Done(OpenPath(Str(a, "path"))),
        "openUrl" => Done(OpenUrl(Str(a, "url"))),
        "copy" => Done(Copy(Str(a, "text"))),
        "recycleInfo" => Done(demo?.Recycle ?? RecycleInfo()),
        "emptyRecycle" => EmptyRecycle(),
        "games" => Games(Flag(a, "refresh")),
        "uninstallGame" => Done(UninstallGame(Str(a, "key"))),
        "apps" => Apps(Flag(a, "refresh")),
        "uninstallApp" => Done(UninstallApp(Str(a, "key"))),
        "dupes" => Dupes(Num(a, "minSize")),
        "cancelDupes" => Done(CancelDupes()),
        "elevate" => Done(Elevate()),
        _ => throw new InvalidOperationException("Unbekannter Befehl: " + cmd),
    };

    // ================================================================ general

    static bool IsAdmin()
    {
        using var id = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
    }

    object Init() => new
    {
        admin = demo != null || IsAdmin(),
        version = typeof(Bridge).Assembly.GetName().Version?.ToString(3),
        demo = demo != null,
        drives = demo?.Drives ?? Drives(),
        recycle = demo?.Recycle ?? RecycleInfo(),
        startPage = options.Page,
        startScan = options.ScanPath,
        summary = root == null ? null : Summary(),
        busy,
    };

    static object Drives()
    {
        string sys = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
        var list = new List<object>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady) continue;
                list.Add(new
                {
                    path = d.RootDirectory.FullName,
                    label = d.VolumeLabel,
                    type = d.DriveType.ToString(),
                    format = d.DriveFormat,
                    total = d.TotalSize,
                    free = d.AvailableFreeSpace,
                    system = d.Name.Equals(sys, StringComparison.OrdinalIgnoreCase),
                });
            }
            catch { /* drive vanished */ }
        }
        return list;
    }

    static object RecycleInfo()
    {
        var (size, count) = Native.QueryRecycleBin();
        return new { size, count };
    }

    string? PickFolder()
    {
        using var dlg = new FolderBrowserDialog { Description = "Ordner zum Analysieren wählen", UseDescriptionForTitle = true };
        return dlg.ShowDialog(win) == DialogResult.OK ? dlg.SelectedPath : null;
    }

    static object? Reveal(string path)
    {
        Process.Start("explorer.exe", $"/select,\"{path}\"");
        return null;
    }

    static object? OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        return null;
    }

    static object? OpenUrl(string url)
    {
        int colon = url.IndexOf(':');
        if (colon <= 0 || !AllowedSchemes.Contains(url[..colon], StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("Dieser Link kann nicht geöffnet werden.");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return null;
    }

    static object? Copy(string text)
    {
        Clipboard.SetText(text);
        return null;
    }

    object? Elevate()
    {
        string args = "";
        if (root != null)
        {
            string p = root.Name.EndsWith('\\') ? root.Name + "\\" : root.Name; // keep the closing quote from being escaped
            args = $"--scan \"{p}\"";
        }
        try
        {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas", Arguments = args });
            win.BeginInvoke(win.Close);
            return true;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false; // UAC cancelled
        }
    }

    // ================================================================ scanning

    object StartScan(string path)
    {
        if (cleaning) throw new InvalidOperationException("Bitte warten, bis die Bereinigung fertig ist.");
        if (busy) throw new InvalidOperationException("Es läuft bereits ein Scan.");
        if (!Directory.Exists(path)) throw new InvalidOperationException("Ordner nicht gefunden: " + path);
        _ = FullScan(path);
        return new { started = true };
    }

    async Task FullScan(string path)
    {
        long est = 0;
        try
        {
            var full = Path.GetFullPath(path);
            if (full.Length <= 3) { var di = new DriveInfo(full); est = di.TotalSize - di.TotalFreeSpace; }
        }
        catch { }
        var (node, sc) = await ScanAsync(path, est);
        if (node == null)
        {
            Emit("scanDone", new { error = "Scan fehlgeschlagen" });
            return;
        }
        root = node;
        extensions = sc.Extensions;
        objs.Clear();
        ids.Clear();
        lastScan = (sc.Errors, sc.CloudBytes, clock.Elapsed.TotalSeconds, sc.Cancelled);
        hints = CleanupAdvisor.Analyze(root);
        Emit("scanDone", Summary());
    }

    async Task<(DirNode? node, Scanner sc)> ScanAsync(string path, long est)
    {
        busy = true;
        var sc = scanner = new Scanner();
        scanCts = new CancellationTokenSource();
        var token = scanCts.Token;
        estimate = est;
        clock.Restart();
        timer.Start();
        Emit("scanStart", new { path });
        DirNode? node = null;
        try { node = await Task.Run(() => sc.Scan(path, token)); }
        catch { /* reported as failed scan */ }
        finally
        {
            timer.Stop();
            clock.Stop();
            busy = false;
        }
        return (node, sc);
    }

    void EmitProgress()
    {
        if (scanner is not { } s) return;
        long bytes = Interlocked.Read(ref s.Bytes);
        Emit("scanProgress", new
        {
            files = Interlocked.Read(ref s.Files),
            dirs = Interlocked.Read(ref s.Dirs),
            bytes,
            current = s.Current,
            pct = estimate > 0 ? Math.Min(0.99, (double)bytes / estimate) : -1,
            elapsed = clock.Elapsed.TotalSeconds,
        });
    }

    object? Cancel()
    {
        scanCts?.Cancel();
        return null;
    }

    async Task<object?> Rescan(long id)
    {
        EnsureIdle();
        var d = (DirNode)Obj(id);
        if (d == root)
        {
            await FullScan(d.FullPath);
            return null;
        }
        await RescanNode(d);
        Changed();
        return null;
    }

    async Task RescanNode(DirNode d)
    {
        string path = d.FullPath;
        if (!Directory.Exists(path))
        {
            TreeOps.RemoveDir(d);
            return;
        }
        var (node, _) = await ScanAsync(path, d.Size);
        if (node != null) TreeOps.Replace(d, node);
    }

    /// <summary>Re-evaluates hints after the tree changed and tells the page.</summary>
    void Changed()
    {
        if (root == null) return;
        hints = CleanupAdvisor.Analyze(root);
        Emit("treeChanged", Summary());
    }

    object Summary()
    {
        var r = root!;
        object? drive = demo?.Drive;
        try
        {
            var di = new DriveInfo(Path.GetPathRoot(r.Name)!);
            drive ??= new { path = di.Name, total = di.TotalSize, free = di.AvailableFreeSpace, label = di.VolumeLabel };
        }
        catch { }
        long Sum(Safety s) => hints.Where(h => h.Safety == s).Sum(h => h.Size);
        long SafeWith(params HintAction[] actions) => hints.Where(h => h.Safety == Safety.Safe && actions.Contains(h.Action)).Sum(h => h.Size);
        return new
        {
            rootId = Id(r),
            path = r.FullPath,
            size = r.Size,
            files = r.FileCount,
            dirs = r.DirCount,
            errors = lastScan.errors,
            cloud = lastScan.cloud,
            seconds = lastScan.seconds,
            cancelled = lastScan.cancelled,
            drive,
            reclaim = new
            {
                safe = Sum(Safety.Safe), tool = Sum(Safety.Tool), review = Sum(Safety.Review), keep = Sum(Safety.Keep),
                quick = SafeWith(HintAction.CleanContents, HintAction.EmptyRecycleBin), // what quick cleanup empties
                dev = SafeWith(HintAction.DeleteFolder),                                // node_modules, target, .next …
            },
            hintCount = hints.Count,
            top = (r.Children ?? []).Take(8).Select(c => new { id = Id(c), name = c.Name, size = c.Size }),
        };
    }

    // ================================================================ browsing

    DirNode LiveDir(long id)
    {
        var d = Obj(id) as DirNode ?? throw new InvalidOperationException("Kein Ordner.");
        if (root == null || !d.IsWithin(root)) throw new InvalidOperationException("Ordner wurde inzwischen neu eingelesen.");
        return d;
    }

    object NodeInfo(long id)
    {
        var d = LiveDir(id);
        var crumbs = new List<object>();
        for (var x = d; x != null; x = x.Parent) crumbs.Insert(0, new { id = Id(x), name = x.Name });

        var items = new List<object>();
        if (d.Children != null)
            foreach (var c in d.Children)
                items.Add(new { id = Id(c), name = c.Name, kind = "dir", size = c.Size, files = c.FileCount, dirs = c.DirCount, mod = Ms(c.LastWriteUtc), denied = c.AccessDenied });

        // Small files are not kept in memory; list the folder live.
        var files = new List<(FileEntry f, bool cloud)>();
        var big = d.BigFiles?.ToDictionary(f => f.Name, StringComparer.OrdinalIgnoreCase);
        if (demo != null)
            files.AddRange((d.BigFiles ?? []).Select(f => (f, false)));
        else try
        {
            foreach (var fi in new DirectoryInfo(d.FullPath).EnumerateFiles("*", FileList))
            {
                bool cloud = Scanner.IsCloudOnly(fi.Attributes);
                var fe = big != null && big.TryGetValue(fi.Name, out var known) ? known : new FileEntry(fi.Name, cloud ? 0 : fi.Length, fi.LastWriteTimeUtc, d);
                files.Add((fe, cloud && fi.Length > 0));
            }
        }
        catch { /* gone or no access */ }
        files.Sort((x, y) => y.f.Size.CompareTo(x.f.Size));
        const int MaxFiles = 1500;
        foreach (var (f, cloud) in files.Take(MaxFiles))
            items.Add(new { id = Id(f), name = f.Name, kind = "file", size = f.Size, ext = f.Extension, mod = Ms(f.LastWriteUtc), cloud });

        return new
        {
            id = Id(d),
            name = d.Name,
            path = d.FullPath,
            size = d.Size,
            files = d.FileCount,
            dirs = d.DirCount,
            mod = Ms(d.LastWriteUtc),
            denied = d.AccessDenied,
            parentId = d.Parent != null ? Id(d.Parent) : -1,
            crumbs,
            items,
            moreFiles = Math.Max(0, files.Count - MaxFiles),
        };
    }

    sealed class ChartNode
    {
        public int I { get; set; }
        public string N { get; set; } = "";
        public long S { get; set; }
        public string T { get; set; } = "d";
        public List<ChartNode>? C { get; set; }
    }

    /// <summary>Nested size data for sunburst/treemap, breadth first with a node budget.</summary>
    object Chart(long id)
    {
        var d = LiveDir(id);
        long min = Math.Max(1, d.Size / 900);
        var top = new ChartNode { I = Id(d), N = d.Name, S = d.Size };
        var queue = new Queue<(DirNode node, ChartNode outNode, int depth)>();
        queue.Enqueue((d, top, 0));
        int count = 0;
        while (queue.Count > 0 && count < 6000)
        {
            var (n, o, depth) = queue.Dequeue();
            if (depth >= 6) continue;
            var kids = new List<ChartNode>();
            long shown = 0;
            if (n.Children != null)
                foreach (var c in n.Children)
                {
                    if (c.Size < min) break;
                    var co = new ChartNode { I = Id(c), N = c.Name, S = c.Size };
                    kids.Add(co);
                    shown += c.Size;
                    queue.Enqueue((c, co, depth + 1));
                }
            if (n.BigFiles != null)
                foreach (var f in n.BigFiles)
                {
                    if (f.Size < min) break;
                    kids.Add(new ChartNode { I = Id(f), N = f.Name, S = f.Size, T = "f" });
                    shown += f.Size;
                }
            long rest = n.Size - shown;
            if (rest >= min) kids.Add(new ChartNode { I = Id(n), N = "Kleinere Elemente", S = rest, T = "o" });
            kids.Sort((a, b) => b.S.CompareTo(a.S));
            count += kids.Count;
            if (kids.Count > 0) o.C = kids;
        }
        return top;
    }

    object Types()
    {
        long total = Math.Max(1, extensions.Values.Sum(x => x.Bytes));
        return extensions.OrderByDescending(kv => kv.Value.Bytes).Take(400).Select(kv => new
        {
            ext = kv.Key.ToLowerInvariant(),
            bytes = kv.Value.Bytes,
            count = kv.Value.Count,
            share = (double)kv.Value.Bytes / total,
        });
    }

    object Files()
    {
        if (root == null) return Array.Empty<object>();
        return Items.LargestFiles(root, 3000).Select(f => new
        {
            id = Id(f), name = f.Name, dir = f.Parent.FullPath, size = f.Size, ext = f.Extension, mod = Ms(f.LastWriteUtc),
        });
    }

    object HintList() => hints.Select((h, i) => new
    {
        hid = i,
        category = h.Category,
        safety = h.Safety.ToString().ToLowerInvariant(),
        advice = h.Advice,
        path = h.Path,
        size = h.Size,
        itemId = Id(h.Item),
        isDir = h.Item is DirNode,
        action = h.Action.ToString(),
    });

    // ================================================================ cleaning & deleting

    async Task<object?> Clean(string path)
    {
        EnsureIdle();
        var h = hints.FirstOrDefault(x => x.Path.Equals(path, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Tipp nicht mehr aktuell – bitte neu laden.");
        long before = root?.Size ?? 0;
        switch (h.Action)
        {
            case HintAction.EmptyRecycleBin:
                Native.EmptyRecycleBin(win.Handle);
                if (h.Item is DirNode bin) await RescanNode(bin);
                break;
            case HintAction.CleanContents when h.Item is DirNode d:
                await Task.Run(() => Cleaner.DeleteContents(d.FullPath));
                await RescanNode(d);
                break;
            case HintAction.DeleteFolder when h.Item is DirNode d:
                await Task.Run(() => Cleaner.DeleteTree(d.FullPath));
                await RescanNode(d);
                break;
            case HintAction.DeleteFile when h.Item is FileEntry f:
                await Task.Run(() => Cleaner.DeleteFile(new FileInfo(f.FullPath)));
                if (!File.Exists(f.FullPath)) TreeOps.RemoveFile(f);
                break;
            case HintAction.Hibernate:
                RunElevated("powercfg.exe", "/h off");
                return new { freed = 0L, note = "Ruhezustand wird deaktiviert – hiberfil.sys verschwindet sofort bzw. nach dem nächsten Neustart." };
            case HintAction.StorageSettings:
                OpenUrl("ms-settings:storagesense");
                return new { freed = 0L, note = "Windows-Speichereinstellungen geöffnet." };
            default:
                throw new InvalidOperationException("Für diesen Eintrag gibt es keine automatische Bereinigung.");
        }
        long freed = Math.Max(0, before - (root?.Size ?? 0));
        Changed();
        return new { freed };
    }

    /// <summary>
    /// Runs the selected hints one after another in the background. The page shows a blocking
    /// progress dialog fed by "cleanProgress" events; "cancelClean" stops after the current file.
    /// </summary>
    async Task<object?> AutoClean(List<string> paths)
    {
        EnsureIdle();
        var list = paths
            .Select(p => hints.FirstOrDefault(h => h.Path.Equals(p, StringComparison.OrdinalIgnoreCase)))
            .OfType<Hint>()
            .Where(h => AutoActions.Contains(h.Action))
            .ToList();
        if (list.Count == 0) throw new InvalidOperationException("Diese Empfehlungen sind nicht mehr aktuell – bitte neu laden.");

        cleaning = true;
        var cts = cleanCts = new CancellationTokenSource();
        var p = new CleanProgress();
        var errors = new List<string>();
        long planned = list.Sum(h => h.Size), done = 0;
        int index = 0;
        var current = list[0];

        void Report() => Emit("cleanProgress", new
        {
            index, count = list.Count, category = current.Category, path = p.Current ?? current.Path,
            planned, done, itemSize = current.Size,
            freed = Interlocked.Read(ref p.Freed), files = Interlocked.Read(ref p.Files),
            cancelling = cts.IsCancellationRequested,
        });

        using var tick = new System.Windows.Forms.Timer { Interval = 120 };
        tick.Tick += (_, _) => Report();
        tick.Start();
        try
        {
            for (; index < list.Count && !cts.IsCancellationRequested; index++)
            {
                current = list[index];
                p.Current = null;
                Report();
                try
                {
                    switch (current.Action)
                    {
                        case HintAction.EmptyRecycleBin:
                            var (binSize, _) = Native.QueryRecycleBin();
                            if (Native.EmptyRecycleBin(win.Handle, silent: true)) Interlocked.Add(ref p.Freed, binSize);
                            break;
                        case HintAction.CleanContents when current.Item is DirNode d:
                            await Task.Run(() => Cleaner.DeleteContents(d.FullPath, p, cts.Token));
                            break;
                        case HintAction.DeleteFolder when current.Item is DirNode d:
                            await Task.Run(() => Cleaner.DeleteTree(d.FullPath, p, cts.Token));
                            break;
                        case HintAction.DeleteFile when current.Item is FileEntry f:
                            await Task.Run(() => Cleaner.DeleteFile(new FileInfo(f.FullPath), p));
                            break;
                    }
                    await Refresh(current.Item);
                }
                catch (Exception ex)
                {
                    errors.Add($"{current.Category}: {ex.Message}");
                }
                done += current.Size;
            }
        }
        finally
        {
            tick.Stop();
            cleaning = false;
        }
        index = Math.Min(index, list.Count - 1);
        Report();
        Changed();
        return new
        {
            freed = Interlocked.Read(ref p.Freed),
            files = Interlocked.Read(ref p.Files),
            cancelled = cts.IsCancellationRequested,
            errors,
            recycle = RecycleInfo(),
        };
    }

    object? CancelClean()
    {
        cleanCts?.Cancel();
        return null;
    }

    /// <summary>Brings a cleaned folder or file of the tree up to date without a visible scan.</summary>
    async Task Refresh(object item)
    {
        if (root == null) return;
        if (item is DirNode d && d.IsWithin(root))
        {
            string path = d.FullPath;
            if (!Directory.Exists(path)) TreeOps.RemoveDir(d);
            else if (await Task.Run(() => new Scanner().Scan(path, CancellationToken.None)) is { } fresh) TreeOps.Replace(d, fresh);
        }
        else if (item is FileEntry f && !File.Exists(f.FullPath) && f.Parent.IsWithin(root))
            TreeOps.RemoveFile(f);
    }

    static void RunElevated(string exe, string args)
    {
        try
        {
            Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new InvalidOperationException("Abgebrochen (Administratorrechte wurden nicht erteilt).");
        }
    }

    async Task<object?> Delete(long id, string mode)
    {
        EnsureIdle();
        var item = Obj(id);
        if (item == root) throw new InvalidOperationException("Der gescannte Hauptordner kann nicht gelöscht werden.");
        string path = Items.PathOf(item);
        long before = root?.Size ?? 0;
        bool recycle = mode != "permanent";

        if (item is DirNode d)
        {
            if (recycle) FileSystem.DeleteDirectory(path, UIOption.AllDialogs, RecycleOption.SendToRecycleBin, UICancelOption.DoNothing);
            else await Task.Run(() => Cleaner.DeleteTree(path));
            if (!Directory.Exists(path)) TreeOps.RemoveDir(d);
            else await RescanNode(d);
        }
        else if (item is FileEntry f)
        {
            if (recycle) FileSystem.DeleteFile(path, UIOption.AllDialogs, RecycleOption.SendToRecycleBin, UICancelOption.DoNothing);
            else await Task.Run(() => Cleaner.DeleteFile(new FileInfo(path)));
            bool isTracked = f.Parent.BigFiles?.Contains(f) == true;
            if (!File.Exists(path))
            {
                if (isTracked) TreeOps.RemoveFile(f);
                else
                {
                    f.Parent.OwnFilesSize -= f.Size;
                    f.Parent.OwnFileCount--;
                    TreeOps.Propagate(f.Parent, -f.Size, -1, 0);
                }
            }
        }
        else throw new InvalidOperationException("Dieses Element kann nicht gelöscht werden.");

        long freed = Math.Max(0, before - (root?.Size ?? 0));
        Changed();
        return new { freed, exists = Directory.Exists(path) || File.Exists(path) };
    }

    async Task<object?> EmptyRecycle()
    {
        Native.EmptyRecycleBin(win.Handle);
        var bin = root?.Children?.FirstOrDefault(c => c.Name.Equals("$Recycle.Bin", StringComparison.OrdinalIgnoreCase));
        if (bin != null && !busy)
        {
            await RescanNode(bin);
            Changed();
        }
        return RecycleInfo();
    }

    // ================================================================ games & programs

    async Task<object?> Games(bool refresh)
    {
        if (demo == null && (games == null || refresh))
        {
            var found = await Task.Run(GameFinder.Find);
            games = found.OrderByDescending(g => g.Size).ToList();
            StartSizing();
        }
        return games;
    }

    object? UninstallGame(string key)
    {
        var g = games?.FirstOrDefault(x => x.Key == key) ?? throw new InvalidOperationException("Spiel nicht gefunden.");
        switch (g.UninstallKind)
        {
            case "cmd": UninstallRegistry.Run(g.UninstallValue!); break;
            case "url" or "launcher" or "settings": Process.Start(new ProcessStartInfo(g.UninstallValue!) { UseShellExecute = true }); break;
            default: throw new InvalidOperationException("Für dieses Spiel ist keine Deinstallation hinterlegt.");
        }
        return new { hint = g.UninstallHint };
    }

    async Task<object?> Apps(bool refresh)
    {
        if (demo == null && (apps == null || refresh))
        {
            apps = await Task.Run(UninstallRegistry.Read);
            StartSizing();
        }
        return apps!.Select(AppDto);
    }

    static object AppDto(UninstallEntry e) => new
    {
        key = e.Key,
        name = e.Name,
        publisher = e.Publisher,
        version = e.Version,
        installed = e.InstallDate,
        size = e.EstimatedSize,
        exact = e.Exact,
        location = e.Location,
        icon = e.IconUrl ?? (e.IconPath != null ? $"https://app.local/icon?p={Uri.EscapeDataString(e.IconPath)}&i={e.IconIndex}" : null),
        canUninstall = e.Uninstall != null,
        user = e.User,
        missing = e.Missing,
    };

    object? UninstallApp(string key)
    {
        var e = apps?.FirstOrDefault(x => x.Key == key) ?? throw new InvalidOperationException("Programm nicht gefunden.");
        if (e.Uninstall == null) throw new InvalidOperationException("Für dieses Programm ist kein Deinstallationsprogramm hinterlegt.");
        UninstallRegistry.Run(e.Uninstall);
        return null;
    }

    /// <summary>Measures game and program folders in the background and streams the results.</summary>
    void StartSizing()
    {
        sizeCts?.Cancel();
        var cts = sizeCts = new CancellationTokenSource();
        var gameList = games?.ToList() ?? [];
        var appList = apps?.Where(a => !a.Exact && UninstallRegistry.IsOwnFolder(a.Location)).ToList() ?? [];
        var tree = root;
        Task.Run(() =>
        {
            long Measure(string path)
            {
                try
                {
                    if (tree != null && TreeOps.Find(tree, path) is { } n) return n.Size;
                    return new Scanner().Scan(path, cts.Token).Size;
                }
                catch { return -1; }
            }
            foreach (var g in gameList.OrderByDescending(x => x.Size))
            {
                if (cts.IsCancellationRequested) return;
                if (!g.Exact && Measure(g.Path) is var s and >= 0) { g.Size = s; g.Exact = true; }
                foreach (var x in g.Extras) x.Size = Math.Max(0, Measure(x.Path));
                Emit("gameSize", new { key = g.Key, size = g.Size, extras = g.Extras });
            }
            foreach (var a in appList)
            {
                if (cts.IsCancellationRequested) return;
                if (Measure(a.Location!) is var s and > 0) { a.EstimatedSize = s; a.Exact = true; }
                Emit("appSize", new { key = a.Key, size = a.EstimatedSize });
            }
        });
    }

    // ================================================================ duplicates

    async Task<object?> Dupes(long minSize)
    {
        if (root == null) throw new InvalidOperationException("Bitte zuerst ein Laufwerk scannen.");
        dupeCts?.Cancel();
        var cts = dupeCts = new CancellationTokenSource();
        var r = root;
        long last = 0;
        List<DupeGroup> groups;
        if (demo != null) groups = demo.Dupes.Where(g => g.Size >= minSize).ToList();
        else try
        {
            groups = await Task.Run(() => DupeFinder.Find(r, Math.Max(1 << 20, minSize), (done, total) =>
            {
                long now = Environment.TickCount64;
                if (now - last < 120 && done < total) return;
                last = now;
                Emit("dupesProgress", new { done, total });
            }, cts.Token));
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        return groups.Take(500).Select(g => new
        {
            size = g.Size,
            wasted = g.Wasted,
            exact = g.Exact,
            files = g.Files.Select(f => new { id = Id(f), name = f.Name, dir = f.Parent.FullPath, mod = Ms(f.LastWriteUtc) }),
        });
    }

    object? CancelDupes()
    {
        dupeCts?.Cancel();
        return null;
    }
}

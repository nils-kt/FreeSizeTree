using System.Text;

namespace FreeSizeTree;

/// <summary>
/// A fictional PC used for the README images (--render-docs) and the --demo mode.
/// All names, games and programs are made up; nothing here touches the real disk.
/// </summary>
sealed class DemoData
{
    const long KB = 1024, MB = KB * 1024, GB = MB * 1024;
    const long DriveTotal = 1_000_204_886_016; // "1 TB"

    public DirNode Root { get; }
    public Dictionary<string, ExtStat> Extensions { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<Game> Games { get; } = [];
    public List<UninstallEntry> Apps { get; } = [];
    public List<DupeGroup> Dupes { get; } = [];
    public object[] Drives { get; }
    public object Drive { get; }
    public object Recycle => new { size = (long)(2.4 * GB), count = 318L };

    readonly Random rng = new(7);
    readonly DateTime now = DateTime.UtcNow;

    static readonly string[] Generic =
    [
        "assets", "cache", "data", "build", "lib", "media", "logs", "backup", "export", "raw", "textures", "audio",
        "shaders", "maps", "models", "sounds", "images", "archive", "resources", "packages", "plugins", "config",
        "fonts", "samples", "presets", "locales", "bin", "content", "levels", "movies",
    ];
    static readonly string[] Pictures = ["2021", "2022", "2023", "2024", "2025", "2026", "Urlaub", "Familie", "Screenshots", "Kamera", "RAW", "Bearbeitet", "Hochzeit", "Wandern"];
    static readonly string[] Videos = ["Aufnahmen", "Projekte", "Exporte", "Drohne", "Clips", "Rohmaterial", "Streams", "Tutorials", "Familie"];
    static readonly string[] Documents = ["Rechnungen", "Steuer", "Uni", "Bewerbungen", "Verträge", "Scans", "Notizen", "Präsentationen", "Vorlagen", "Archiv"];
    static readonly string[] NodeModules = ["@babel", "@types", "react-dom", "typescript", "esbuild", "next", "webpack", "lodash", "@swc", "rollup", "sass", "eslint", "vite", "jest", "core-js", "zod"];
    static readonly string[] Source = ["src", "public", "assets", "components", "tests", "docs", "scripts", "dist", ".git"];

    public DemoData()
    {
        var games = new List<(string name, string src, DirNode dir, int played, DirNode? shader, DirNode? workshop, int hue)>();
        var dupes = new List<(bool exact, FileEntry[] files)>();
        Root = BuildTree(games, dupes);
        Scanner.Aggregate(Root);

        long used = Root.Size + 24 * GB;
        long free = Math.Max(19 * GB, DriveTotal - used);
        Drive = new { path = "C:\\", total = DriveTotal, free, label = "System" };
        Drives =
        [
            new { path = "C:\\", label = "System", type = "Fixed", format = "NTFS", total = DriveTotal, free, system = true },
            new { path = "D:\\", label = "Daten", type = "Fixed", format = "NTFS", total = 2_000_398_934_016L, free = 812L * GB, system = false },
            new { path = "E:\\", label = "Backup", type = "Removable", format = "exFAT", total = 4_000_787_030_016L, free = 2_610L * GB, system = false },
        ];

        int i = 0;
        foreach (var g in games)
        {
            var extras = new List<GameExtra>();
            if (g.shader != null) extras.Add(new GameExtra { Label = "Shader-Cache", Path = g.shader.FullPath, Size = g.shader.Size });
            if (g.workshop != null) extras.Add(new GameExtra { Label = "Workshop-Inhalte", Path = g.workshop.FullPath, Size = g.workshop.Size });
            Games.Add(new Game
            {
                Key = "demo:" + i++,
                Source = g.src,
                Name = g.name,
                Path = g.dir.FullPath,
                Size = g.dir.Size,
                Exact = true,
                LastPlayed = g.played > 0 ? Ms(now.AddDays(-g.played)) : null,
                Installed = Ms(now.AddDays(-rng.Next(60, 900))),
                Image = Cover(g.name, g.hue),
                LaunchUrl = "demo://",
                UninstallKind = "url",
                UninstallValue = "demo://",
                Extras = extras,
            });
        }
        Games.Sort((a, b) => b.Size.CompareTo(a.Size));

        foreach (var (exact, files) in dupes)
            Dupes.Add(new DupeGroup { Size = files[0].Size, Exact = exact, Files = [.. files] });
        Dupes.Sort((a, b) => b.Wasted.CompareTo(a.Wasted));

        BuildApps();
        BuildExtensions();
    }

    static long Ms(DateTime utc) => new DateTimeOffset(utc).ToUnixTimeMilliseconds();

    // ------------------------------------------------------------------ tree helpers

    DirNode Dir(DirNode parent, string name)
    {
        var d = new DirNode(name, parent) { LastWriteUtc = now.AddDays(-rng.Next(1, 500)) };
        (parent.Children ??= []).Add(d);
        return d;
    }

    DirNode P(DirNode from, string relative)
    {
        var d = from;
        foreach (var seg in relative.Split('\\'))
            d = d.Children?.FirstOrDefault(c => c.Name == seg) ?? Dir(d, seg);
        return d;
    }

    void Files(DirNode d, long bytes)
    {
        d.OwnFilesSize += bytes;
        d.OwnFileCount += (int)Math.Max(1, bytes / (rng.Next(60, 2400) * KB));
    }

    FileEntry Big(DirNode d, string name, double gb, int daysAgo)
    {
        var f = new FileEntry(name, (long)(gb * GB), now.AddDays(-daysAgo), d);
        (d.BigFiles ??= []).Add(f);
        d.OwnFilesSize += f.Size;
        d.OwnFileCount++;
        return f;
    }

    /// <summary>Distributes a size over a random but plausible sub-tree.</summary>
    void Spread(DirNode d, double gb, int depth, string[]? pool = null)
    {
        long bytes = (long)(gb * GB);
        if (depth <= 0 || bytes < 60 * MB)
        {
            Files(d, bytes);
            return;
        }
        pool ??= Generic;
        long own = (long)(bytes * (0.04 + rng.NextDouble() * 0.12));
        Files(d, own);
        int n = rng.Next(4, 10);
        var weights = Enumerable.Range(0, n).Select(_ => Math.Pow(rng.NextDouble() + 0.05, 2.2)).ToArray();
        double sum = weights.Sum();
        var taken = new HashSet<string>(d.Children?.Select(c => c.Name) ?? [], StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < n; i++)
        {
            string name = pool[rng.Next(pool.Length)];
            for (int t = 0; t < 12 && taken.Contains(name); t++) name = pool[rng.Next(pool.Length)];
            if (!taken.Add(name)) continue;
            Spread(Dir(d, name), (bytes - own) * weights[i] / sum / GB, depth - 1, Generic);
        }
    }

    // ------------------------------------------------------------------ the fictional PC

    DirNode BuildTree(List<(string, string, DirNode, int, DirNode?, DirNode?, int)> games, List<(bool, FileEntry[])> dupes)
    {
        var root = new DirNode("C:\\", null);
        var alex = P(root, @"Users\alex");
        var local = P(alex, @"AppData\Local");

        Spread(P(local, "Temp"), 12.4, 2);
        Spread(P(local, "npm-cache"), 6.8, 2, ["_cacache", "index-v5", "content-v2", "tmp", "_logs"]);
        Big(P(local, @"Harbor\wsl\disk"), "harbor_data.vhdx", 48.6, 2);
        Spread(P(local, @"Orbit Browser\User Data\Default\Cache"), 3.1, 1);
        var crash = P(local, "CrashDumps");
        Big(crash, "PixelForge.exe.18244.dmp", 1.2, 40);
        Spread(crash, 0.9, 0);
        Spread(P(local, @"pip\cache"), 3.4, 1);
        Spread(P(local, @"Programs\CodeNest"), 2.8, 2);
        Spread(P(alex, @"AppData\Roaming\CodeNest\CachedData"), 1.2, 1);
        Spread(P(alex, @"AppData\Roaming\SoundWeave"), 4.5, 2);

        var downloads = P(alex, "Downloads");
        var iso = Big(downloads, "nimbus-linux-24.04-amd64.iso", 5.9, 210);
        Big(downloads, "Atlas3D_Setup_2026.exe", 2.4, 95);
        var zip = Big(downloads, "Fotos_Hochzeit_Original.zip", 8.7, 400);
        var holiday = Big(downloads, "Urlaub_Kroatien_4K.mp4", 3.2, 300);
        Spread(downloads, 8.3, 1);

        var videos = P(alex, "Videos");
        var holiday2 = Big(P(videos, "Urlaub 2025"), "Urlaub_Kroatien_4K.mp4", 3.2, 290);
        var final1 = Big(P(videos, "Projekte"), "Projekt_Final_v3.mov", 1.4, 80);
        var final2 = Big(P(videos, "Exporte"), "Projekt_Final_v3.mov", 1.4, 79);
        var final3 = Big(P(alex, "Desktop"), "Projekt_Final_v3.mov", 1.4, 79);
        Big(P(videos, "Drohne"), "DJI_0420_Panorama.mp4", 4.8, 150);
        Spread(videos, 46, 3, Videos);

        Spread(P(alex, "Pictures"), 33, 3, Pictures);
        var docs = P(alex, "Documents");
        var zip2 = Big(P(docs, "Archiv"), "Fotos_Hochzeit_Original.zip", 8.7, 380);
        Spread(docs, 14, 3, Documents);
        var iso2 = Big(P(alex, "Desktop"), "nimbus-linux-24.04-amd64.iso", 5.9, 200);
        Spread(P(alex, "Desktop"), 3.5, 2);

        var projects = P(alex, "Projects");
        foreach (var (name, total, modules) in new[] { ("web-shop", 3.9, 1.8), ("dashboard", 2.6, 1.2), ("mobile-app", 4.2, 1.5), ("portfolio", 1.1, 0.6) })
        {
            var p = Dir(projects, name);
            Spread(Dir(p, "node_modules"), modules, 2, NodeModules);
            Spread(p, total - modules, 2, Source);
        }
        var engine = P(projects, "game-engine");
        var model2 = Big(P(engine, "models"), "diffusion-xl-base.safetensors", 6.9, 120);
        Spread(engine, 9, 3);

        var hub = P(alex, @".cache\huggingface\hub");
        var model1 = Big(P(hub, "models--openlab--diffusion-xl-base"), "diffusion-xl-base.safetensors", 6.9, 130);
        Big(P(hub, "models--openlab--chat-8b"), "model-00001-of-00002.safetensors", 4.9, 60);
        Big(P(hub, "models--openlab--chat-8b"), "model-00002-of-00002.safetensors", 4.1, 60);
        Spread(hub, 5.2, 2);

        var programFiles = P(root, "Program Files");
        foreach (var (name, gb) in AppSizes) Spread(Dir(programFiles, name), gb, 2);

        // games
        var common = P(root, @"Games\SteamLibrary\steamapps\common");
        var shaderRoot = P(root, @"Games\SteamLibrary\steamapps\shadercache");
        var workshopRoot = P(root, @"Games\SteamLibrary\steamapps\workshop\content");
        int id = 1840;
        foreach (var (name, src, fullGb, played, shader, workshop, hue) in GameList)
        {
            double gb = fullGb * 0.72; // keeps the fictional 1 TB drive believable
            var dir = src switch
            {
                "Steam" => Dir(common, name),
                "Epic" => Dir(P(root, @"Games\Epic Games"), name),
                "GOG" => Dir(P(root, @"Games\GOG Galaxy"), name),
                "EA" => Dir(P(root, @"Games\EA Games"), name),
                _ => Dir(P(root, "XboxGames"), name),
            };
            Big(dir, "data_00.pak", gb * 0.22, 30);
            Big(dir, "data_01.pak", gb * 0.17, 30);
            Big(dir, "cinematics.bik", gb * 0.08, 30);
            Spread(dir, gb * 0.53, 2);
            id += 37;
            DirNode? sh = null, ws = null;
            if (shader > 0) Spread(sh = Dir(shaderRoot, id.ToString()), shader, 1);
            if (workshop > 0) Spread(ws = Dir(workshopRoot, id.ToString()), workshop, 2);
            games.Add((name, src, dir, played, sh, ws, hue));
        }

        var windows = P(root, "Windows");
        Spread(Dir(windows, "WinSxS"), 9.4, 2);
        Spread(Dir(windows, "Installer"), 4.1, 1);
        Spread(P(windows, @"SoftwareDistribution\Download"), 3.3, 1);
        Spread(Dir(windows, "System32"), 7.8, 2);
        Spread(Dir(windows, "Temp"), 1.6, 1);
        Spread(P(root, "Windows.old"), 21.5, 2);
        Spread(P(root, "$Recycle.Bin"), 2.4, 1);
        Spread(P(root, "ProgramData"), 13.2, 2);
        Big(root, "hiberfil.sys", 12.8, 1);
        Big(root, "pagefile.sys", 16, 0);

        dupes.Add((true, [zip, zip2]));
        dupes.Add((true, [iso, iso2]));
        dupes.Add((false, [model1, model2]));
        dupes.Add((true, [holiday, holiday2]));
        dupes.Add((true, [final1, final2, final3]));
        return root;
    }

    static readonly (string name, string src, double gb, int played, double shader, double workshop, int hue)[] GameList =
    [
        ("Starfall Odyssey", "Steam", 118, 3, 2.1, 0, 262),
        ("Echoes of Aether", "Steam", 92, 410, 1.4, 0, 196),
        ("Neon Drift Racing", "Epic", 68, 0, 0, 0, 318),
        ("Ironhold Tactics", "Steam", 54, 260, 0.6, 1.2, 28),
        ("Skyline Builders", "EA", 45, 0, 0, 0, 152),
        ("Frontier Freight Simulator", "Steam", 39, 1, 0.8, 6.4, 210),
        ("Hollow Crown", "GOG", 31, 0, 0, 0, 350),
        ("Deep Signal", "Xbox", 27, 0, 0, 0, 175),
        ("Rift Runners", "Steam", 22, 35, 0.3, 0, 285),
        ("Mossheart", "Steam", 8.4, 520, 0.1, 0, 110),
        ("Pixel Pioneers", "Epic", 3.1, 0, 0, 0, 45),
    ];

    static readonly (string name, double gb)[] AppSizes =
    [
        ("Atlas 3D Modeler", 14.2), ("Lumen Video Editor", 9.8), ("PixelForge Studio", 7.6), ("SoundWeave DAW", 6.1),
        ("Retro Emulator Suite", 5.3), ("Nimbus Office", 4.4), ("Harbor Desktop", 3.4), ("CodeNest IDE", 2.9),
        ("Stellar Planetarium", 2.2), ("TaxPilot 2026", 1.8), ("Canvas Paint", 1.1), ("Orbit Browser", 0.9),
    ];

    void BuildApps()
    {
        var info = new (string name, string publisher, string version, int days)[]
        {
            ("Atlas 3D Modeler", "Atlas Software", "2026.2", 120), ("Lumen Video Editor", "Lumen Media", "19.4.1", 40),
            ("PixelForge Studio", "PixelForge Labs", "27.1", 200), ("SoundWeave DAW", "SoundWeave GmbH", "12.0.3", 300),
            ("Retro Emulator Suite", "RetroDev", "0.9.4", 640), ("Nimbus Office", "Nimbus Software", "2025", 500),
            ("Harbor Desktop", "Harbor Inc.", "4.38", 15), ("CodeNest IDE", "CodeNest", "1.98", 8),
            ("Stellar Planetarium", "Stellar", "1.3", 365), ("TaxPilot 2026", "TaxPilot", "26.1", 180),
            ("Canvas Paint", "Canvas Tools", "2.7", 700), ("Orbit Browser", "Orbit Labs", "142.0", 3),
        };
        int i = 0;
        foreach (var (name, publisher, version, days) in info)
        {
            var node = TreeOps.Find(Root, @"C:\Program Files\" + name);
            Apps.Add(new UninstallEntry
            {
                Key = "demo:" + i, Name = name, Publisher = publisher, Version = version,
                InstallDate = Ms(now.AddDays(-days)), EstimatedSize = node?.Size ?? 0, Exact = true,
                Location = node?.FullPath, IconUrl = AppIcon(name, (i * 47 + 200) % 360), Uninstall = "demo",
            });
            i++;
        }
        foreach (var (name, publisher, version, mb) in new[]
                 {
                     ("Quill Notes", "Quill", "3.2", 410), ("Beacon Chat", "Beacon", "1.44", 620), ("VaultKeeper", "Vault Security", "8.1", 210),
                     ("Fjord VPN", "Fjord AS", "5.0", 280), ("Sketch Viewer", "Canvas Tools", "1.0", 95),
                 })
        {
            Apps.Add(new UninstallEntry
            {
                Key = "demo:" + i, Name = name, Publisher = publisher, Version = version, InstallDate = Ms(now.AddDays(-rng.Next(10, 400))),
                EstimatedSize = mb * MB, Exact = false, IconUrl = AppIcon(name, (i * 47 + 200) % 360), Uninstall = "demo",
            });
            i++;
        }
        Apps.Add(new UninstallEntry
        {
            Key = "demo:" + i, Name = "Old Photo Suite 2019", Publisher = "Atlas Software", Version = "9.0",
            EstimatedSize = (long)(3.1 * GB), IconUrl = AppIcon("Old Photo Suite", 30), Uninstall = "demo", Missing = true,
        });
    }

    void BuildExtensions()
    {
        var shares = new (string ext, double share, long count)[]
        {
            ("pak", .21, 640), ("mp4", .14, 1840), ("vhdx", .055, 3), ("dll", .07, 88412), ("jpg", .055, 48210), ("safetensors", .025, 9),
            ("mov", .03, 212), ("exe", .025, 9204), ("cr3", .03, 3920), ("sys", .035, 1820), ("zip", .025, 312), ("png", .02, 61234),
            ("wav", .02, 4100), ("bik", .03, 128), ("js", .012, 912345), ("iso", .012, 4), ("tmp", .01, 22014), ("db", .008, 1203),
            ("json", .004, 184332), ("dmp", .003, 6), ("", .03, 240118),
        };
        double total = shares.Sum(s => s.share);
        foreach (var (ext, share, count) in shares)
            Extensions[ext] = new ExtStat { Bytes = (long)(Root.Size * share / total * 0.97), Count = count };
    }

    // ------------------------------------------------------------------ generated artwork

    static string Svg(string svg) => "data:image/svg+xml;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes(svg));

    /// <summary>Poster-like cover art for a fictional game.</summary>
    static string Cover(string title, int hue)
    {
        var lines = new List<string>();
        foreach (var word in title.ToUpperInvariant().Split(' '))
        {
            if (lines.Count > 0 && lines[^1].Length + word.Length < 11) lines[^1] += " " + word;
            else lines.Add(word);
        }
        int fs = lines.Max(l => l.Length) > 9 ? 58 : 70;
        var text = new StringBuilder();
        for (int i = 0; i < lines.Count; i++)
            text.Append($"<tspan x='300' dy='{(i == 0 ? 0 : fs + 6)}'>{System.Security.SecurityElement.Escape(lines[i])}</tspan>");
        return Svg($@"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 900'>
<defs>
<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='hsl({hue},75%,62%)'/><stop offset='.5' stop-color='hsl({hue + 30},60%,32%)'/><stop offset='1' stop-color='hsl({hue + 60},55%,9%)'/></linearGradient>
<radialGradient id='s' cx='.7' cy='.52' r='.4'><stop offset='0' stop-color='hsl({hue + 40},100%,88%)'/><stop offset='1' stop-color='hsl({hue + 40},100%,88%)' stop-opacity='0'/></radialGradient>
</defs>
<rect width='600' height='900' fill='url(#g)'/>
<circle cx='420' cy='470' r='230' fill='url(#s)'/>
<circle cx='420' cy='470' r='92' fill='hsl({hue + 40},100%,90%)' opacity='.92'/>
<path d='M0 640 L140 480 L250 570 L390 410 L600 630 L600 900 L0 900Z' fill='hsl({hue + 50},45%,16%)' opacity='.9'/>
<path d='M0 740 L170 610 L320 700 L460 590 L600 690 L600 900 L0 900Z' fill='hsl({hue + 60},40%,7%)'/>
<text y='268' text-anchor='middle' font-family='Segoe UI Variable Display, Segoe UI, sans-serif' font-weight='800' font-size='{fs}' letter-spacing='3' fill='white' style='paint-order:stroke' stroke='rgba(0,0,0,.25)' stroke-width='6'>{text}</text>
</svg>");
    }

    static string AppIcon(string name, int hue)
    {
        string letter = System.Security.SecurityElement.Escape(name[..1].ToUpperInvariant())!;
        return Svg($@"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl({hue},80%,62%)'/><stop offset='1' stop-color='hsl({hue + 40},70%,42%)'/></linearGradient></defs>
<rect x='4' y='4' width='56' height='56' rx='15' fill='url(#g)'/>
<text x='32' y='43' text-anchor='middle' font-family='Segoe UI, sans-serif' font-weight='700' font-size='30' fill='white'>{letter}</text>
</svg>");
    }
}

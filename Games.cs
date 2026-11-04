using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace FreeSizeTree;

sealed class GameExtra
{
    public required string Label { get; init; }
    public required string Path { get; init; }
    public long Size { get; set; }
}

sealed class Game
{
    public required string Key { get; init; }
    public required string Source { get; init; }
    public required string Name { get; init; }
    public required string Path { get; init; }
    public string Kind { get; init; } = "Spiel";
    public long Size { get; set; }
    public bool Exact { get; set; }
    public long? LastPlayed { get; init; }
    public long? Installed { get; init; }
    public string? Image { get; init; }
    public string? Icon { get; init; }
    public string? LaunchUrl { get; init; }
    public string? StoreUrl { get; init; }
    public string UninstallKind { get; init; } = "none"; // url | cmd | launcher | settings | none
    public string? UninstallValue { get; init; }
    public string? UninstallHint { get; init; }
    public List<GameExtra> Extras { get; init; } = [];
}

/// <summary>Finds installed games of the common PC launchers.</summary>
static class GameFinder
{
    public static string? SteamPath { get; private set; }

    public static List<Game> Find()
    {
        var games = new List<Game>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(Game g)
        {
            string key = Norm(g.Path);
            if (key.Length == 0 || !Directory.Exists(g.Path) || !seen.Add(key)) return;
            games.Add(g);
        }
        Try(() => Steam(Add));
        Try(() => Epic(Add));
        Try(() => Gog(Add));
        Try(() => Xbox(Add));
        Try(() => FromUninstallRegistry(Add));
        return games;
    }

    static void Try(Action a) { try { a(); } catch { /* one broken launcher must not hide the others */ } }

    static string Norm(string p)
    {
        try { return Path.TrimEndingDirectorySeparator(Path.GetFullPath(p)); } catch { return ""; }
    }

    static long? Unix(string? s) => long.TryParse(s, out var v) && v > 0 ? v * 1000 : null;

    // ------------------------------------------------------------------ Steam

    static void Steam(Action<Game> add)
    {
        string? steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                        ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string;
        if (string.IsNullOrEmpty(steam)) return;
        steam = Norm(steam.Replace('/', '\\'));
        SteamPath = steam;

        var libs = new List<string> { steam };
        string vdf = Path.Join(steam, "steamapps", "libraryfolders.vdf");
        if (File.Exists(vdf) && Vdf.Parse(File.ReadAllText(vdf)).Get("libraryfolders") is { } lf)
            foreach (var entry in lf.Values.OfType<Dictionary<string, object>>())
                if (entry.TryGetValue("path", out var p) && p is string s) libs.Add(Norm(s));

        foreach (var lib in libs.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            string apps = Path.Join(lib, "steamapps");
            if (!Directory.Exists(apps)) continue;
            foreach (var acf in Directory.EnumerateFiles(apps, "appmanifest_*.acf"))
            {
                Dictionary<string, object>? st;
                try { st = Vdf.Parse(File.ReadAllText(acf)).Get("AppState"); } catch { continue; }
                if (st == null) continue;
                string id = st.Str("appid") ?? "", name = st.Str("name") ?? id, dir = st.Str("installdir") ?? "";
                if (id.Length == 0 || dir.Length == 0) continue;
                var extras = new List<GameExtra>();
                string shader = Path.Join(apps, "shadercache", id), workshop = Path.Join(apps, "workshop", "content", id);
                if (Directory.Exists(shader)) extras.Add(new GameExtra { Label = "Shader-Cache", Path = shader });
                if (Directory.Exists(workshop)) extras.Add(new GameExtra { Label = "Workshop-Inhalte", Path = workshop });
                add(new Game
                {
                    Key = "steam:" + id,
                    Source = "Steam",
                    Name = name,
                    Path = Path.Join(apps, "common", dir),
                    Kind = id == "228980" ? "Tool" : "Spiel",
                    Size = long.TryParse(st.Str("SizeOnDisk"), out var sz) ? sz : 0,
                    LastPlayed = Unix(st.Str("LastPlayed")),
                    Installed = Unix(st.Str("LastUpdated")),
                    Image = "https://app.local/steamimg/" + id,
                    LaunchUrl = "steam://rungameid/" + id,
                    StoreUrl = "https://store.steampowered.com/app/" + id,
                    UninstallKind = "url",
                    UninstallValue = "steam://uninstall/" + id,
                    Extras = extras,
                });
            }
        }
    }

    /// <summary>Local cover art from Steam's library cache.</summary>
    public static string? SteamImage(string appId)
    {
        if (SteamPath == null || !appId.All(char.IsDigit)) return null;
        string dir = Path.Join(SteamPath, "appcache", "librarycache", appId);
        string flat = Path.Join(SteamPath, "appcache", "librarycache", appId + "_library_600x900.jpg");
        if (File.Exists(flat)) return flat;
        if (!Directory.Exists(dir)) return null;
        string direct = Path.Join(dir, "library_600x900.jpg");
        if (File.Exists(direct)) return direct;
        return Directory.EnumerateFiles(dir, "library_600x900*.jpg", SearchOption.AllDirectories).FirstOrDefault()
               ?? Directory.EnumerateFiles(dir, "library_capsule*.jpg", SearchOption.AllDirectories).FirstOrDefault();
    }

    // ------------------------------------------------------------------ Epic

    static void Epic(Action<Game> add)
    {
        string dir = Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Epic", "EpicGamesLauncher", "Data", "Manifests");
        if (!Directory.Exists(dir)) return;
        foreach (var file in Directory.EnumerateFiles(dir, "*.item"))
        {
            JsonElement j;
            try { j = JsonDocument.Parse(File.ReadAllText(file)).RootElement; } catch { continue; }
            string S(string k) => j.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            var cats = j.TryGetProperty("AppCategories", out var c) && c.ValueKind == JsonValueKind.Array
                ? c.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : [];
            if (cats.Any(x => x.StartsWith("plugins"))) continue;
            string app = S("AppName"), main = S("MainGameAppName");
            if (main.Length > 0 && main != app) continue; // DLC lives inside the main game
            if (j.TryGetProperty("bIsIncompleteInstall", out var inc) && inc.ValueKind == JsonValueKind.True) continue;
            string loc = S("InstallLocation"), exe = S("LaunchExecutable");
            add(new Game
            {
                Key = "epic:" + app,
                Source = "Epic",
                Name = S("DisplayName"),
                Path = loc,
                Kind = cats.Any(x => x.StartsWith("engines")) ? "Engine" : "Spiel",
                Size = j.TryGetProperty("InstallSize", out var s) && s.TryGetInt64(out var sz) ? sz : 0,
                Icon = exe.Length > 0 ? Path.Join(loc, exe.Replace('/', '\\')) : null,
                LaunchUrl = $"com.epicgames.launcher://apps/{S("CatalogNamespace")}%3A{S("CatalogItemId")}%3A{app}?action=launch&silent=true",
                UninstallKind = "launcher",
                UninstallValue = "com.epicgames.launcher://",
                UninstallHint = "Im Epic Games Launcher: Bibliothek › Spiel › „…“ › Deinstallieren.",
            });
        }
    }

    // ------------------------------------------------------------------ GOG

    static void Gog(Action<Game> add)
    {
        using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\GOG.com\Games");
        if (key == null) return;
        foreach (var sub in key.GetSubKeyNames())
        {
            using var g = key.OpenSubKey(sub);
            if (g == null) continue;
            string id = g.GetValue("gameID") as string ?? sub;
            string path = g.GetValue("path") as string ?? "";
            string? uninstall = Registry.GetValue($@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{id}_is1", "UninstallString", null) as string;
            add(new Game
            {
                Key = "gog:" + id,
                Source = "GOG",
                Name = g.GetValue("gameName") as string ?? sub,
                Path = path,
                Icon = g.GetValue("exe") as string,
                LaunchUrl = "goggalaxy://openGameView/" + id,
                UninstallKind = uninstall != null ? "cmd" : "url",
                UninstallValue = uninstall ?? "goggalaxy://openGameView/" + id,
            });
        }
    }

    // ------------------------------------------------------------------ Xbox / Microsoft Store

    static void Xbox(Action<Game> add)
    {
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed) continue;
            string root = Path.Join(drive.RootDirectory.FullName, "XboxGames");
            if (!Directory.Exists(root)) continue;
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                if (!Directory.Exists(Path.Join(dir, "Content"))) continue;
                add(new Game
                {
                    Key = "xbox:" + dir,
                    Source = "Xbox",
                    Name = Path.GetFileName(dir),
                    Path = dir,
                    UninstallKind = "settings",
                    UninstallValue = "ms-settings:appsfeatures",
                    UninstallHint = "Über Einstellungen › Apps › Installierte Apps oder die Xbox-App deinstallieren.",
                });
            }
        }
    }

    // ------------------------------------------------------------------ Uninstall registry (EA, Rockstar, Battle.net, Ubisoft, Riot …)

    static readonly (Regex publisher, string source)[] Publishers =
    [
        (new("Rockstar", RegexOptions.IgnoreCase), "Rockstar"),
        (new("Electronic Arts", RegexOptions.IgnoreCase), "EA"),
        (new("Blizzard", RegexOptions.IgnoreCase), "Battle.net"),
        (new("Riot Games", RegexOptions.IgnoreCase), "Riot"),
        (new("Ubisoft", RegexOptions.IgnoreCase), "Ubisoft"),
        (new("Amazon Game", RegexOptions.IgnoreCase), "Amazon"),
    ];

    static readonly Regex NotAGame = new(@"Launcher|Social Club|\bSDK\b|^EA app|^Battle\.net|Riot Client|Ubisoft Connect|Online Services|Redistributable|Anti-?Cheat|Overlay|Installer|^Origin",
        RegexOptions.IgnoreCase);

    static void FromUninstallRegistry(Action<Game> add)
    {
        foreach (var e in UninstallRegistry.Read())
        {
            if (e.Uninstall?.Contains("steam://", StringComparison.OrdinalIgnoreCase) == true) continue;
            string source = "";
            foreach (var (re, src) in Publishers)
                if (re.IsMatch(e.Publisher ?? "")) { source = src; break; }
            if (e.Uninstall?.Contains("uplay://", StringComparison.OrdinalIgnoreCase) == true) source = "Ubisoft";
            if (source.Length == 0 || NotAGame.IsMatch(e.Name)) continue;
            string? path = e.Location;
            if (string.IsNullOrEmpty(path) && e.IconPath is { } icon && icon.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                path = Path.GetDirectoryName(icon);
            if (!UninstallRegistry.IsOwnFolder(path)) continue;
            add(new Game
            {
                Key = "reg:" + e.Key,
                Source = source,
                Name = e.Name,
                Path = path!,
                Size = e.EstimatedSize,
                Installed = e.InstallDate,
                Icon = e.IconPath,
                UninstallKind = e.Uninstall != null ? "cmd" : "none",
                UninstallValue = e.Uninstall,
            });
        }
    }
}

/// <summary>Minimal parser for Valve's KeyValues (.vdf/.acf) text format.</summary>
static class Vdf
{
    public static Dictionary<string, object> Parse(string text)
    {
        int i = 0;
        return ParseObject(text, ref i);
    }

    static Dictionary<string, object> ParseObject(string t, ref int i)
    {
        var d = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        while (true)
        {
            var key = Token(t, ref i);
            if (key == null || key == "}") return d;
            var val = Token(t, ref i);
            if (val == null) return d;
            d[key] = val == "{" ? ParseObject(t, ref i) : val;
        }
    }

    static string? Token(string t, ref int i)
    {
        while (i < t.Length)
        {
            char c = t[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '/' && i + 1 < t.Length && t[i + 1] == '/') { while (i < t.Length && t[i] != '\n') i++; continue; }
            if (c is '{' or '}') { i++; return c.ToString(); }
            if (c == '"')
            {
                var sb = new System.Text.StringBuilder();
                i++;
                while (i < t.Length && t[i] != '"')
                {
                    if (t[i] == '\\' && i + 1 < t.Length) { i++; sb.Append(t[i] switch { 'n' => '\n', 't' => '\t', _ => t[i] }); }
                    else sb.Append(t[i]);
                    i++;
                }
                i++;
                return sb.ToString();
            }
            int start = i;
            while (i < t.Length && !char.IsWhiteSpace(t[i]) && t[i] is not ('{' or '}' or '"')) i++;
            return t[start..i];
        }
        return null;
    }

    public static Dictionary<string, object>? Get(this Dictionary<string, object> d, string key) =>
        d.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;

    public static string? Str(this Dictionary<string, object> d, string key) =>
        d.TryGetValue(key, out var v) ? v as string : null;
}

using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace FreeSizeTree;

sealed class UninstallEntry
{
    public required string Key { get; init; }
    public required string Name { get; init; }
    public string? Publisher { get; init; }
    public string? Version { get; init; }
    public long? InstallDate { get; init; }
    public long EstimatedSize { get; set; }
    public bool Exact { get; set; }
    public string? Location { get; init; }
    public string? IconPath { get; init; }
    public string? IconUrl { get; init; } // ready-made image (demo data)
    public int IconIndex { get; init; }
    public string? Uninstall { get; init; }
    public bool User { get; init; }
    /// <summary>Registry entry whose program folder no longer exists (left over after a manual delete).</summary>
    public bool Missing { get; init; }
}

/// <summary>Reads installed programs from the Windows "Uninstall" registry keys.</summary>
static class UninstallRegistry
{
    const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    public static List<UninstallEntry> Read()
    {
        var list = new List<UninstallEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (hive, view) in new[]
                 {
                     (RegistryHive.LocalMachine, RegistryView.Registry64),
                     (RegistryHive.LocalMachine, RegistryView.Registry32),
                     (RegistryHive.CurrentUser, RegistryView.Registry64),
                 })
        {
            try
            {
                using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                using var key = baseKey.OpenSubKey(UninstallKey);
                if (key == null) continue;
                foreach (var sub in key.GetSubKeyNames())
                {
                    using var k = key.OpenSubKey(sub);
                    if (k == null || Read(k, sub, hive == RegistryHive.CurrentUser) is not { } e) continue;
                    if (seen.Add(e.Name + "|" + e.Version)) list.Add(e);
                }
            }
            catch { /* hive not accessible */ }
        }
        return list;
    }

    static UninstallEntry? Read(RegistryKey k, string sub, bool user)
    {
        string? name = k.GetValue("DisplayName") as string;
        if (string.IsNullOrWhiteSpace(name)) return null;
        if (k.GetValue("SystemComponent") is int sc && sc == 1) return null;
        if (k.GetValue("ParentKeyName") != null) return null;
        if (k.GetValue("ReleaseType") is string rt && (rt.Contains("Update") || rt.Contains("Hotfix"))) return null;
        if (Regex.IsMatch(name, @"^(Security )?Update for|\(KB\d+\)")) return null;

        string? icon = (k.GetValue("DisplayIcon") as string)?.Trim(), rawIcon = null;
        int iconIndex = 0;
        if (icon != null)
        {
            var m = Regex.Match(icon, @"^""?(.+?)""?(?:,(-?\d+))?$");
            if (m.Success)
            {
                icon = m.Groups[1].Value.Trim('"');
                if (m.Groups[2].Success) iconIndex = int.Parse(m.Groups[2].Value);
            }
            rawIcon = icon;
            if (!File.Exists(icon)) icon = null;
        }
        long? date = null;
        if (k.GetValue("InstallDate") is string ds && DateTime.TryParseExact(ds, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
            date = new DateTimeOffset(dt).ToUnixTimeMilliseconds();
        string? location = (k.GetValue("InstallLocation") as string)?.Trim().Trim('"');
        bool missing = !string.IsNullOrEmpty(location)
            ? !Directory.Exists(location)
            : rawIcon != null && icon == null && rawIcon.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && IsOwnFolder(Path.GetDirectoryName(rawIcon));
        if (string.IsNullOrEmpty(location) || !Directory.Exists(location)) location = null;

        return new UninstallEntry
        {
            Key = (user ? "u:" : "m:") + sub,
            Name = name.Trim(),
            Publisher = (k.GetValue("Publisher") as string)?.Trim(),
            Version = k.GetValue("DisplayVersion") as string,
            InstallDate = date,
            EstimatedSize = k.GetValue("EstimatedSize") is int kb ? kb * 1024L : 0,
            Location = location,
            IconPath = icon,
            IconIndex = iconIndex,
            Uninstall = (k.GetValue("UninstallString") as string)?.Trim(),
            User = user,
            Missing = missing,
        };
    }

    /// <summary>True if a folder is specific enough that its size belongs to one program.</summary>
    public static bool IsOwnFolder(string? path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        string p;
        try { p = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)); } catch { return false; }
        if (p.Length <= 3) return false;
        string[] shared =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
        ];
        return !shared.Any(s => s.Equals(p, StringComparison.OrdinalIgnoreCase)) &&
               !p.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows) + "\\", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Runs an uninstall command line (UAC is shown by Windows if needed).</summary>
    public static void Run(string commandLine)
    {
        string cmd = commandLine.Trim(), exe, args;
        if (cmd.StartsWith('"'))
        {
            int end = cmd.IndexOf('"', 1);
            exe = cmd[1..end];
            args = cmd[(end + 1)..].Trim();
        }
        else
        {
            int i = cmd.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
            if (i > 0) { exe = cmd[..(i + 4)]; args = cmd[(i + 4)..].Trim(); }
            else
            {
                int sp = cmd.IndexOf(' ');
                exe = sp > 0 ? cmd[..sp] : cmd;
                args = sp > 0 ? cmd[(sp + 1)..] : "";
            }
        }
        if (exe.EndsWith("msiexec.exe", StringComparison.OrdinalIgnoreCase) || exe.Equals("msiexec", StringComparison.OrdinalIgnoreCase))
            args = Regex.Replace(args, @"/I\s*\{", "/X{", RegexOptions.IgnoreCase);
        Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = true });
    }
}

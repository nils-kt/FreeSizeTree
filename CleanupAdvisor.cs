namespace FreeSizeTree;

enum Safety { Safe, Tool, Review, Keep }

/// <summary>What the one-click button of a hint does.</summary>
enum HintAction { None, EmptyRecycleBin, CleanContents, DeleteFolder, DeleteFile, Hibernate, StorageSettings }

sealed record Hint(string Category, Safety Safety, string Advice, object Item, long Size, HintAction Action = HintAction.None)
{
    public string Path => Items.PathOf(Item);
}

/// <summary>Finds well-known space hogs in a scanned tree and explains how to get rid of them.</summary>
static class CleanupAdvisor
{
    const long MB = 1L << 20, GB = 1L << 30;

    public static string Label(Safety s) => s switch
    {
        Safety.Safe => "Sicher löschbar",
        Safety.Tool => "Mit Windows-Tool",
        Safety.Review => "Prüfen",
        _ => "Nicht löschen",
    };

    public static Color ColorOf(Safety s) => s switch
    {
        Safety.Safe => Color.FromArgb(0, 125, 0),
        Safety.Tool => Color.FromArgb(0, 90, 180),
        Safety.Review => Color.FromArgb(180, 100, 0),
        _ => Color.FromArgb(190, 0, 0),
    };

    public static List<Hint> Analyze(DirNode root)
    {
        var list = new List<Hint>();
        var stack = new Stack<DirNode>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            if (d != root && MatchDir(d) is { } h)
            {
                long min = h.Category == "Papierkorb" ? 1 : h.Safety == Safety.Review ? 100 * MB : 20 * MB;
                if (h.Size >= min) list.Add(h with { Action = ActionFor(h) });
                continue; // don't report nested matches twice
            }
            if (d.BigFiles != null)
                foreach (var f in d.BigFiles)
                    if (MatchFile(f) is { } fh) list.Add(fh with { Action = ActionFor(fh) });
            if (d.Children != null)
                foreach (var c in d.Children)
                {
                    if (c.Size < 10 * MB) break; // children are sorted by size
                    stack.Push(c);
                }
        }
        list.Sort((a, b) => b.Size.CompareTo(a.Size));
        return list;
    }

    static HintAction ActionFor(Hint h) => h.Category switch
    {
        "Papierkorb" => HintAction.EmptyRecycleBin,
        "Temporäre Dateien" or "Absturzberichte" or "Paketmanager-Cache" or "App-/Browser-Cache" => HintAction.CleanContents,
        "npm-Abhängigkeiten" or "Rust-Build-Ausgabe" or "Next.js-Build-Cache" or "Python-Umgebung" => HintAction.DeleteFolder,
        "Speicherabbild" or "Backup-/Restdatei" => HintAction.DeleteFile,
        "Ruhezustandsdatei" => HintAction.Hibernate,
        _ when h.Safety == Safety.Tool => HintAction.StorageSettings,
        _ => HintAction.None,
    };

    static bool Is(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    static bool IsDriveRoot(DirNode? d) => d is { Parent: null } && d.Name.Length <= 3;

    static bool UnderAppData(DirNode d)
    {
        for (var p = d.Parent; p != null; p = p.Parent)
            if (Is(p.Name, "AppData")) return true;
        return false;
    }

    static Hint? MatchDir(DirNode d)
    {
        string n = d.Name, p = d.Parent?.Name ?? "", gp = d.Parent?.Parent?.Name ?? "";
        bool atRoot = IsDriveRoot(d.Parent);
        Hint H(string cat, Safety s, string advice) => new(cat, s, advice, d, d.Size);

        if (atRoot && Is(n, "$Recycle.Bin"))
            return H("Papierkorb", Safety.Safe, "Gelöschte Dateien liegen noch im Papierkorb und belegen weiter Platz. Über „Papierkorb leeren“ in der Symbolleiste freigeben.");
        if (atRoot && Is(n, "Windows.old"))
            return H("Alte Windows-Installation", Safety.Tool, "Einstellungen › System › Speicher › Temporäre Dateien › „Vorherige Windows-Installation(en)“. Nicht über den Explorer löschen.");
        if (atRoot && Is(n, "System Volume Information"))
            return H("Wiederherstellungspunkte", Safety.Tool, "Systemsteuerung › System › Computerschutz › Konfigurieren: Speicherplatz begrenzen oder alte Wiederherstellungspunkte löschen.");
        if (Is(n, "WinSxS") && Is(p, "Windows"))
            return H("Windows-Komponentenspeicher", Safety.Keep, "NICHT manuell löschen! Als Administrator ausführen: „Dism /Online /Cleanup-Image /StartComponentCleanup“. Die angezeigte Größe ist durch Hardlinks überschätzt.");
        if (Is(n, "Installer") && Is(p, "Windows"))
            return H("Windows Installer-Cache", Safety.Keep, "NICHT manuell löschen – sonst lassen sich Programme nicht mehr reparieren, aktualisieren oder deinstallieren.");
        if (Is(n, "Download") && Is(p, "SoftwareDistribution"))
            return H("Windows Update-Cache", Safety.Tool, "Einstellungen › System › Speicher › Temporäre Dateien › „Windows Update-Bereinigung“ (oder Datenträgerbereinigung).");
        if (Is(n, "DeliveryOptimization"))
            return H("Übermittlungsoptimierung", Safety.Tool, "Einstellungen › System › Speicher › Temporäre Dateien › „Übermittlungsoptimierungsdateien“.");
        if (Is(n, "Temp") && (Is(p, "Local") || (Is(p, "Windows") && IsDriveRoot(d.Parent?.Parent))))
            return H("Temporäre Dateien", Safety.Safe, "Kann geleert werden – gerade benutzte Dateien werden einfach übersprungen. Alternativ: Einstellungen › System › Speicher › Temporäre Dateien.");
        if (Is(n, "CrashDumps") || Is(n, "Minidump") || Is(n, "LiveKernelReports") ||
            ((Is(n, "ReportArchive") || Is(n, "ReportQueue")) && Is(p, "WER")))
            return H("Absturzberichte", Safety.Safe, "Absturz- und Fehlerberichte; werden nur zur Fehleranalyse benötigt.");
        if (IsPackageCache(n, p))
            return H("Paketmanager-Cache", Safety.Safe, "Download-Cache, wird bei Bedarf neu geladen. Sauber leeren z. B. mit „npm cache clean --force“, „pip cache purge“, „uv cache clean“, „dotnet nuget locals all --clear“, „conda clean --all“.");
        if (Is(n, "node_modules"))
            return H("npm-Abhängigkeiten", Safety.Safe, "Lässt sich im Projekt jederzeit mit „npm install“ wiederherstellen – besonders lohnend bei alten Projekten.");
        if (Is(n, "target") && d.Parent != null && File.Exists(System.IO.Path.Join(d.Parent.FullPath, "Cargo.toml")))
            return H("Rust-Build-Ausgabe", Safety.Safe, "Kompilierte Zwischenstände von Cargo. Im Projekt „cargo clean“ ausführen – wird beim nächsten Build neu erzeugt.");
        if (Is(n, ".next") && d.Parent != null && File.Exists(System.IO.Path.Join(d.Parent.FullPath, "package.json")))
            return H("Next.js-Build-Cache", Safety.Safe, "Build-Ausgabe und Cache von Next.js; wird bei „next dev“ / „next build“ neu erzeugt.");
        if (Is(n, ".venv") || Is(n, "venv"))
            return H("Python-Umgebung", Safety.Review, "Virtuelle Python-Umgebung; lässt sich aus requirements.txt / pyproject.toml neu erstellen.");
        if (Is(n, "huggingface") && Is(p, ".cache"))
            return H("KI-Modelle (Hugging Face)", Safety.Review, "Heruntergeladene Modelle und Datasets. Gezielt aufräumen mit „hf cache delete“ (bzw. „huggingface-cli delete-cache“).");
        if (Is(n, "torch") && Is(p, ".cache"))
            return H("KI-Modelle (PyTorch)", Safety.Review, "Heruntergeladene PyTorch-Hub-Modelle; werden bei Bedarf erneut geladen.");
        if (Is(n, "models") && Is(p, ".ollama"))
            return H("KI-Modelle (Ollama)", Safety.Review, "Nicht benötigte Modelle mit „ollama list“ und „ollama rm <name>“ entfernen.");
        if (Is(n, "api") && Is(p, "pinokio"))
            return H("Pinokio-Apps", Safety.Review, "Installierte KI-Apps inkl. Modelle und Python-Umgebungen. Nicht benötigte Apps in Pinokio löschen.");
        if (IsAppCache(n) && UnderAppData(d))
            return H("App-/Browser-Cache", Safety.Safe, "Zwischenspeicher, wird automatisch neu aufgebaut. Das zugehörige Programm vorher schließen.");
        if (Is(n, "Downloads") && Is(gp, "Users"))
            return H("Downloads-Ordner", Safety.Review, "Alte Installer, Archive und Videos prüfen – hier steckt oft viel Platz.");
        return null;
    }

    static bool IsPackageCache(string n, string p) =>
        Is(n, "npm-cache") || Is(n, "go-build") || Is(n, "pnpm-store") ||
        (Is(n, "packages") && Is(p, ".nuget")) ||
        (Is(n, "caches") && Is(p, ".gradle")) ||
        (Is(n, "repository") && Is(p, ".m2")) ||
        (Is(n, "cache") && (Is(p, "pip") || Is(p, "uv") || Is(p, "Yarn") || Is(p, "pnpm"))) ||
        (Is(n, "uv") && Is(p, ".cache")) ||
        (Is(n, "pkgs") && (Is(p, "anaconda3") || Is(p, "miniconda3") || Is(p, "miniforge3")));

    static readonly HashSet<string> AppCacheNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "Cache", "Code Cache", "GPUCache", "cache2", "CacheStorage", "ShaderCache",
        "DawnCache", "GrShaderCache", "DXCache", "GLCache", "INetCache", "CachedData",
    };

    static bool IsAppCache(string n) => AppCacheNames.Contains(n);

    static Hint? MatchFile(FileEntry f)
    {
        string n = f.Name, ext = f.Extension;
        bool atRoot = IsDriveRoot(f.Parent);
        Hint H(string cat, Safety s, string advice) => new(cat, s, advice, f, f.Size);

        if (atRoot && Is(n, "hiberfil.sys"))
            return H("Ruhezustandsdatei", Safety.Tool, "Als Administrator „powercfg /h off“ (schaltet Ruhezustand & Schnellstart ab) oder „powercfg /h /type reduced“ zum Verkleinern.");
        if (atRoot && (Is(n, "pagefile.sys") || Is(n, "swapfile.sys")))
            return H("Auslagerungsdatei", Safety.Keep, "Nicht löschen. Größe ggf. unter Systemeigenschaften › Erweitert › Leistung › Virtueller Arbeitsspeicher anpassen.");
        if (f.Size >= 100 * MB && (n.Contains(".corrupted", StringComparison.OrdinalIgnoreCase) ||
                                   ext is ".bak" or ".old" or ".tmp" or ".temp"))
            return H("Backup-/Restdatei", Safety.Review, "Sieht nach einer Sicherungs-, Temp- oder Restdatei aus (z. B. „.corrupted“-Kopie einer Datenbank). Programm schließen, prüfen und löschen.");
        if (ext is ".vhdx" or ".vhd" && f.Size >= GB)
            return H("Virtuelle Festplatte", Safety.Review, "WSL/Docker/Hyper-V-Datenträger. Wächst, schrumpft aber nicht von selbst: „wsl --manage <Distro> --set-sparse true“, „docker system prune“ oder Optimize-VHD; ungenutzte Distros mit „wsl --unregister“ entfernen.");
        if (ext is ".iso" or ".img" && f.Size >= 500 * MB)
            return H("Disk-Image", Safety.Review, "ISO/Image-Datei – nach der Installation meist überflüssig.");
        if (ext == ".dmp" && f.Size >= 50 * MB)
            return H("Speicherabbild", Safety.Safe, "Absturz-Speicherabbild (z. B. MEMORY.DMP) – nur zur Fehleranalyse nötig.");
        if (ext is ".gguf" or ".safetensors" or ".ckpt" or ".pt" or ".pth" or ".onnx" && f.Size >= 500 * MB)
            return H("KI-Modelldatei", Safety.Review, "Große Modelldatei – nicht mehr benötigte Modelle löschen.");
        if (ext is ".zip" or ".7z" or ".rar" or ".msi" or ".exe" or ".mp4" or ".mkv" or ".mov" && f.Size >= 2 * GB)
            return H("Sehr große Datei", Safety.Review, "Prüfen, ob die Datei noch gebraucht wird oder auf ein anderes Laufwerk verschoben werden kann.");
        return null;
    }
}

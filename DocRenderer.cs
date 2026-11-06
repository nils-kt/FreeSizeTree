using Microsoft.Web.WebView2.Core;

namespace FreeSizeTree;

/// <summary>
/// Renders the README images (--render-docs): puts the demo app into each state through the
/// window.fst hook (ui/src/docs.ts) and saves a PNG of the web view. No mouse or keyboard input is used.
/// </summary>
static class DocRenderer
{
    static readonly (string file, string script, int wait)[] Shots =
    [
        ("overview.png", "fst.go('overview')", 1500),
        ("scan.png", "fst.scan()", 1000),
        ("explorer.png", "fst.reset(); fst.chart('sunburst')", 1500),
        ("treemap.png", "fst.chart('treemap')", 1300),
        ("cleanup.png", "fst.go('cleanup')", 1300),
        ("quick-clean.png", "fst.autoClean()", 1000),
        ("cleaning.png", "fst.reset(); fst.cleaning()", 1000),
        ("games.png", "fst.reset(); fst.go('games')", 1800),
        ("apps.png", "fst.go('apps')", 1300),
        ("files.png", "fst.go('files')", 1300),
        ("dupes.png", "fst.dupes()", 1400),
        ("types.png", "fst.go('types')", 1500),
    ];

    public static async Task RunAsync(CoreWebView2 web, string folder)
    {
        Directory.CreateDirectory(folder);
        await Task.Delay(2000); // boot, demo games and fonts
        // The real mouse may rest over the window: no hover states in the images.
        await web.ExecuteScriptAsync("document.documentElement.style.pointerEvents = 'none'");
        if (await web.ExecuteScriptAsync("typeof fst") != "\"object\"")
            throw new InvalidOperationException("Docs hook (window.fst) not available.");
        foreach (var (file, script, wait) in Shots)
        {
            await web.ExecuteScriptAsync(script);
            await Task.Delay(wait);
            await using var fs = File.Create(Path.Join(folder, file));
            await web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
        }
    }
}

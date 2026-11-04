using Microsoft.Web.WebView2.Core;

namespace FreeSizeTree;

/// <summary>
/// Renders the README images (--render-docs): opens each page of the demo data through the
/// page's own functions and saves a PNG of the web view. No mouse or keyboard input is used.
/// </summary>
static class DocRenderer
{
    const string CloseDialog = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));";

    static readonly (string file, string script, int wait)[] Shots =
    [
        ("overview.png", "go('overview')", 1900),
        ("scan.png", """
            S.scanning = true; S.fullScan = true; S.scanPath = 'C:\\';
            S.progress = { files: 1284311, dirs: 203118, bytes: 512e9, pct: 0.61, elapsed: 23.4,
                           current: 'C:\\Users\\alex\\Projects\\web-shop\\node_modules\\@babel\\core\\lib' };
            updateScanbar(); go('overview');
            """, 1100),
        ("explorer.png", "S.scanning = false; S.fullScan = false; S.progress = null; updateScanbar(); S.chartMode = 'sunburst'; S.nodeId = S.summary.rootId; go('explorer')", 1500),
        ("treemap.png", "S.chartMode = 'treemap'; render()", 1300),
        ("cleanup.png", "S.hints = null; go('cleanup')", 1500),
        ("quick-clean.png", "quickClean()", 1000),
        ("games.png", CloseDialog + " go('games')", 1800),
        ("apps.png", "go('apps')", 1300),
        ("files.png", "go('files')", 1300),
        ("dupes.png", "api('dupes', { minSize: S.dupeMin }).then(r => { S.dupes = r; go('dupes'); })", 1400),
        ("types.png", "go('types')", 1500),
    ];

    public static async Task RunAsync(CoreWebView2 web, string folder)
    {
        Directory.CreateDirectory(folder);
        await Task.Delay(2000); // boot, demo games and fonts
        // The real mouse may rest over the window: no hover states in the images.
        await web.ExecuteScriptAsync("document.documentElement.style.pointerEvents = 'none'");
        foreach (var (file, script, wait) in Shots)
        {
            await web.ExecuteScriptAsync(script);
            await Task.Delay(wait);
            await using var fs = File.Create(Path.Join(folder, file));
            await web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
        }
    }
}

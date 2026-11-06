using System.Drawing.Imaging;
using System.Reflection;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FreeSizeTree;

sealed record StartOptions(string? ScanPath, string? Page, bool Dev, bool Demo = false, string? RenderDocs = null);

/// <summary>Native window hosting the HTML user interface.</summary>
sealed class AppWindow : Form
{
    // Windows 11 window backgrounds (Mica fallback colors)
    static readonly Color DarkBackground = Color.FromArgb(32, 32, 32);
    static readonly Color LightBackground = Color.FromArgb(243, 243, 243);
    const string Origin = "https://app.local/";

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly StartOptions options;
    readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte[]?> iconCache = new(StringComparer.OrdinalIgnoreCase);
    Bridge? bridge;
    bool dark;

    public AppWindow(StartOptions options)
    {
        this.options = options;
        Text = "FreeSizeTree";
        StartPosition = FormStartPosition.CenterScreen;
        ApplyTheme();
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        FormClosed += (_, _) => Microsoft.Win32.SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(LogicalToDeviceUnits(1480), area.Width - 40), Math.Min(LogicalToDeviceUnits(940), area.Height - 40));
        if (options.RenderDocs != null) ClientSize = new Size(LogicalToDeviceUnits(1440), LogicalToDeviceUnits(880));
        MinimumSize = new Size(LogicalToDeviceUnits(1000), LogicalToDeviceUnits(640));
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        Controls.Add(web);
        Load += async (_, _) => await InitAsync();
        FormClosing += (_, _) => bridge?.Shutdown();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyTheme();
    }

    void OnUserPreferenceChanged(object? sender, Microsoft.Win32.UserPreferenceChangedEventArgs e)
    {
        if (e.Category == Microsoft.Win32.UserPreferenceCategory.General && IsHandleCreated) BeginInvoke(ApplyTheme);
    }

    /// <summary>Follows the Windows app theme; README images are always rendered dark.</summary>
    void ApplyTheme()
    {
        dark = options.RenderDocs != null || Native.AppsUseDarkTheme();
        var bg = dark ? DarkBackground : LightBackground;
        BackColor = bg;
        web.DefaultBackgroundColor = bg;
        if (IsHandleCreated) Native.StyleTitleBar(Handle, dark, bg);
        if (web.CoreWebView2 is { } core)
            core.Profile.PreferredColorScheme = dark ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;
    }

    async Task InitAsync()
    {
        try
        {
            string data = Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FreeSizeTree", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, data);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            if (options.RenderDocs is { } docs) // headless (CI): report instead of blocking on a dialog
            {
                Directory.CreateDirectory(docs);
                File.WriteAllText(Path.Join(docs, "render-error.txt"), ex.ToString());
                Environment.ExitCode = 1;
            }
            else
                MessageBox.Show(this, "Die Microsoft Edge WebView2-Runtime wird benötigt:\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\n" + ex.Message,
                    "FreeSizeTree", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = web.CoreWebView2;
        ApplyTheme();
        core.Settings.AreDevToolsEnabled = options.Dev;
        core.Settings.AreDefaultContextMenusEnabled = options.Dev;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = options.Dev;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;

        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnResource;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };

        bridge = new Bridge(this, core, options);
        core.WebMessageReceived += bridge.OnMessage;
        if (options.RenderDocs is { } folder)
        {
            core.NavigationCompleted += async (_, _) =>
            {
                try { await DocRenderer.RunAsync(core, folder); }
                catch (Exception ex) { Environment.ExitCode = 1; File.WriteAllText(Path.Join(folder, "render-error.txt"), ex.ToString()); }
                Close();
            };
        }
        core.Navigate(Origin + "index.html");
    }

    void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = web.CoreWebView2.Environment;
        var uri = new Uri(e.Request.Uri);
        string path = uri.AbsolutePath;
        byte[]? body = null;
        string type = "application/octet-stream";

        if (path.StartsWith("/icon") || path.StartsWith("/steamimg/"))
        {
            // Icons and cover art are loaded off the UI thread so long lists stay responsive.
            var deferral = e.GetDeferral();
            Task.Run(() =>
            {
                byte[]? data;
                string ct;
                if (path.StartsWith("/icon"))
                {
                    int.TryParse(Query(uri, "i"), out int index);
                    data = IconPng(Query(uri, "p"), index);
                    ct = "image/png";
                }
                else
                {
                    var img = GameFinder.SteamImage(path["/steamimg/".Length..]);
                    data = img != null ? TryRead(img) : null;
                    ct = "image/jpeg";
                }
                BeginInvoke(() =>
                {
                    e.Response = data == null
                        ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
                        : env.CreateWebResourceResponse(new MemoryStream(data), 200, "OK", $"Content-Type: {ct}\r\nCache-Control: max-age=86400");
                    deferral.Complete();
                });
            });
            return;
        }
        else
        {
            string name = "www." + path.TrimStart('/');
            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (s != null)
            {
                using var ms = new MemoryStream();
                s.CopyTo(ms);
                body = ms.ToArray();
                type = Path.GetExtension(name) switch
                {
                    ".html" => "text/html; charset=utf-8",
                    ".css" => "text/css; charset=utf-8",
                    ".js" => "text/javascript; charset=utf-8",
                    ".svg" => "image/svg+xml",
                    ".woff2" => "font/woff2",
                    _ => type,
                };
            }
        }

        e.Response = body == null
            ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
            : env.CreateWebResourceResponse(new MemoryStream(body), 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-store");
    }

    static string Query(Uri uri, string key)
    {
        foreach (var part in uri.Query.TrimStart('?').Split('&'))
        {
            int eq = part.IndexOf('=');
            if (eq > 0 && part[..eq] == key) return Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
        }
        return "";
    }

    static byte[]? TryRead(string file)
    {
        try { return File.ReadAllBytes(file); } catch { return null; }
    }

    byte[]? IconPng(string file, int index)
    {
        string key = file + "|" + index;
        if (iconCache.TryGetValue(key, out var cached)) return cached;
        byte[]? png = null;
        try
        {
            if (File.Exists(file))
            {
                using var icon = file.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)
                    ? new Icon(file, 64, 64)
                    : Icon.ExtractIcon(file, index, 64) ?? Icon.ExtractAssociatedIcon(file);
                if (icon != null)
                {
                    using var bmp = icon.ToBitmap();
                    using var ms = new MemoryStream();
                    bmp.Save(ms, ImageFormat.Png);
                    png = ms.ToArray();
                }
            }
        }
        catch { /* no icon */ }
        iconCache[key] = png;
        return png;
    }
}

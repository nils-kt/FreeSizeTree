using System.Runtime.InteropServices;

namespace FreeSizeTree;

static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    struct SHQUERYRBINFO
    {
        public int cbSize;
        public long i64Size;
        public long i64NumItems;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHQueryRecycleBin(string? pszRootPath, ref SHQUERYRBINFO pSHQueryRBInfo);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHEmptyRecycleBin(IntPtr hwnd, string? pszRootPath, uint dwFlags);

    /// <summary>Total size and item count of all recycle bins, or (0, 0) on failure.</summary>
    public static (long size, long items) QueryRecycleBin()
    {
        var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
        return SHQueryRecycleBin(null, ref info) == 0 ? (info.i64Size, info.i64NumItems) : (0, 0);
    }

    /// <summary>Empties all recycle bins. Unless <paramref name="silent"/>, Windows shows its own confirmation dialog.</summary>
    public static bool EmptyRecycleBin(IntPtr owner, bool silent = false) =>
        SHEmptyRecycleBin(owner, null, silent ? 0x7u : 0u) == 0; // SHERB_NOCONFIRMATION | NOPROGRESSUI | NOSOUND

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    /// <summary>Title bar in the app theme whose caption color blends into the window background (Windows 11).</summary>
    public static void StyleTitleBar(IntPtr hwnd, bool dark, Color caption)
    {
        int on = dark ? 1 : 0;
        DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int));          // DWMWA_USE_IMMERSIVE_DARK_MODE
        int color = caption.R | caption.G << 8 | caption.B << 16;
        DwmSetWindowAttribute(hwnd, 35, ref color, sizeof(int));       // DWMWA_CAPTION_COLOR
        int text = dark ? 0xFFFFFF : 0x1A1A1A;
        DwmSetWindowAttribute(hwnd, 36, ref text, sizeof(int));        // DWMWA_TEXT_COLOR
    }

    /// <summary>Whether Windows apps use the dark theme (Settings › Personalization › Colors).</summary>
    public static bool AppsUseDarkTheme()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }
}


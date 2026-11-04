namespace FreeSizeTree;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Headless mode: FreeSizeTree.exe --report <folder> <output.txt>
        if (args.Length >= 3 && args[0] == "--report")
        {
            Report.Write(args[1], args[2]);
            return;
        }

        string? scan = null, page = null, render = null;
        bool dev = false, demo = false;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--scan" when i + 1 < args.Length: scan = args[++i]; break;
                case "--page" when i + 1 < args.Length: page = args[++i]; break;
                case "--render-docs" when i + 1 < args.Length: render = Path.GetFullPath(args[++i]); break;
                case "--demo": demo = true; break;
                case "--dev": dev = true; break;
                default: if (Directory.Exists(args[i])) scan = args[i]; break;
            }
        }

        // --render-docs always runs on the fictional demo PC, never on real data.
        if (render != null) { demo = true; scan = null; }

        ApplicationConfiguration.Initialize();
        Application.Run(new AppWindow(new StartOptions(scan, page, dev, demo, render)));
        return;
    }
}

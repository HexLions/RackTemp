using System.Windows.Forms;

namespace RackTempTray;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, "RackTempTray_SingleInstance", out var isFirstInstance);
        if (!isFirstInstance)
        {
            // Already running (tray icon already visible): don't open a second
            // window, exit silently.
            return;
        }

        ApplicationConfiguration.Initialize();

        var startMinimized = args.Contains("--minimized");
        var form = new MainForm();
        if (startMinimized)
        {
            form.WindowState = FormWindowState.Minimized;
            form.ShowInTaskbar = false;
        }

        Application.Run(form);
    }
}

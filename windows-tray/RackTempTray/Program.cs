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
            // Già in esecuzione (tray icon già visibile): non aprire una seconda
            // finestra, esci silenziosamente.
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

using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RackTempTray;

// Finestra unica dell'app: mostra RackTemp (WebView2 verso http://localhost:7431)
// dentro una vera finestra invece che nel browser di default. Chiudendola con la
// X non esce dall'app: la nasconde e resta nella tray, esattamente come Discord/
// Slack, e il servizio Windows "RackTemp" (nssm) resta attivo. "Esci" dal menu
// tray invece ferma anche il servizio (richiede UAC, fermare un servizio
// Windows serve elevazione) — è la vera uscita, non solo chiudere la finestra.
public class MainForm : Form
{
    private const string BackendUrl = "http://localhost:7431";

    private readonly NotifyIcon _trayIcon;
    private readonly WebView2 _webView;
    private readonly System.Windows.Forms.Timer _readyTimer;
    private bool _navigatedOnce;
    private bool _reallyExit;

    public MainForm()
    {
        Text = "RackTemp";
        Width = 1100;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
        Controls.Add(_webView);

        _trayIcon = new NotifyIcon
        {
            Icon = Icon,
            Text = "RackTemp",
            Visible = true,
            ContextMenuStrip = BuildTrayMenu(),
        };
        _trayIcon.DoubleClick += (_, _) => ShowMainWindow();

        FormClosing += OnFormClosing;
        Shown += async (_, _) => await InitializeWebViewAsync();

        // Il servizio potrebbe non essere ancora pronto appena il processo nssm
        // parte (bind della porta, avvio Prisma): riprova finché non risponde
        // invece di mostrare subito un errore, a differenza di "apri nel browser"
        // che falliva se il servizio non era ancora su.
        _readyTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _readyTimer.Tick += async (_, _) => await TryNavigateWhenReadyAsync();
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Apri RackTemp", null, (_, _) => ShowMainWindow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Esci e ferma il servizio", null, (_, _) =>
        {
            StopServiceElevated();
            _reallyExit = true;
            Close();
        });
        return menu;
    }

    private static void StopServiceElevated()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "sc.exe",
                Arguments = "stop RackTemp",
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(8000);
        }
        catch (Win32Exception)
        {
            // UAC annullato dall'utente: la finestra si chiude comunque,
            // il servizio resta attivo (nessun danno, solo non fermato).
        }
    }

    private void ShowMainWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private async Task InitializeWebViewAsync()
    {
        // Il profilo WebView2 non può stare nella cartella dell'exe: siamo
        // dentro Program Files, un utente normale non ha permessi di
        // scrittura lì e CreateAsync fallisce con Accesso negato. Serve una
        // cartella dati scrivibile esplicita (AppData dell'utente corrente).
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RackTemp", "WebView2"
        );
        Directory.CreateDirectory(userDataFolder);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await _webView.EnsureCoreWebView2Async(environment);

        await TryNavigateWhenReadyAsync();
        if (!_navigatedOnce)
        {
            _readyTimer.Start();
        }
    }

    private async Task TryNavigateWhenReadyAsync()
    {
        if (_navigatedOnce) return;

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        try
        {
            var res = await http.GetAsync(BackendUrl);
            if (!res.IsSuccessStatusCode) return;
        }
        catch
        {
            return; // non ancora pronto, il timer riprova
        }

        _navigatedOnce = true;
        _readyTimer.Stop();
        _webView.CoreWebView2.Navigate(BackendUrl);
        _webView.Visible = true;
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_reallyExit || e.CloseReason != CloseReason.UserClosing)
        {
            _trayIcon.Visible = false;
            return;
        }

        // Click sulla X: nascondi invece di chiudere, come le app "tray-first".
        // Per fermare davvero il servizio serve "Esci" dal menu tray.
        e.Cancel = true;
        Hide();
        _trayIcon.ShowBalloonTip(
            3000,
            "RackTemp",
            "Continua a girare in background. Doppio click sull'icona per riaprirlo, tasto destro per uscire davvero.",
            ToolTipIcon.Info
        );
    }
}

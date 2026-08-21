using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.ServiceProcess;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace RackTempTray;

// The app's single window: shows RackTemp (WebView2 pointed at http://localhost:7431)
// inside a real window instead of the default browser. Closing it with the
// X doesn't exit the app: it hides it and it stays in the tray, exactly like Discord/
// Slack, and the Windows "RackTemp" service (nssm) stays running. "Exit" from the
// tray menu instead also stops the service (requires UAC, stopping a
// Windows service needs elevation) — that's the real exit, not just closing the window.
// Reopening the app after a full exit makes the service start back up
// on its own if it's found stopped.
public class MainForm : Form
{
    private const string BackendUrl = "http://localhost:7431";
    private const string ServiceName = "RackTemp";
    private const string AutostartRunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AutostartValueName = "RackTemp";

    private readonly NotifyIcon _trayIcon;
    private readonly WebView2 _webView;
    private readonly System.Windows.Forms.Timer _readyTimer;
    private ToolStripMenuItem _autostartMenuItem = null!;
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
        Shown += async (_, _) =>
        {
            _ = EnsureServiceRunningAsync();
            await InitializeWebViewAsync();
        };

        // The service might not be ready yet as soon as the nssm process
        // starts (port binding, Prisma startup): keep retrying until it responds
        // instead of showing an error right away, unlike "open in browser"
        // which used to fail if the service wasn't up yet.
        _readyTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _readyTimer.Tick += async (_, _) => await TryNavigateWhenReadyAsync();
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open RackTemp", null, (_, _) => ShowMainWindow());
        menu.Items.Add(new ToolStripSeparator());
        _autostartMenuItem = new ToolStripMenuItem("Start with Windows at login", null, (_, _) =>
        {
            SetAutostart(!_autostartMenuItem.Checked);
            _autostartMenuItem.Checked = GetAutostart();
        })
        {
            Checked = GetAutostart(),
        };
        menu.Opening += (_, _) => _autostartMenuItem.Checked = GetAutostart();
        menu.Items.Add(_autostartMenuItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit and stop the service", null, (_, _) =>
        {
            StopServiceElevated();
            _reallyExit = true;
            Close();
        });
        return menu;
    }

    // Key in HKCU, no elevation needed to read/write it — unlike
    // starting/stopping the service, this is a preference of the
    // current user, not a system action. Shared between the tray menu
    // and the WebView2 bridge to the Settings page: same source
    // of truth regardless of which interface is used to change it.
    internal static bool GetAutostart()
    {
        using var key = Registry.CurrentUser.OpenSubKey(AutostartRunKey, writable: false);
        return key?.GetValue(AutostartValueName) != null;
    }

    internal static void SetAutostart(bool enable)
    {
        using var key = Registry.CurrentUser.CreateSubKey(AutostartRunKey, writable: true);
        if (enable)
        {
            key.SetValue(AutostartValueName, $"\"{Application.ExecutablePath}\" --minimized");
        }
        else
        {
            key.DeleteValue(AutostartValueName, throwOnMissingValue: false);
        }
    }

    // If the user closed everything with "Exit" (which also stops the service) and
    // then reopens the app, the service needs to be started back up — otherwise the
    // window stays stuck waiting forever. Starting a service
    // requires as much elevation as stopping it.
    private static async Task EnsureServiceRunningAsync()
    {
        try
        {
            using var sc = new ServiceController(ServiceName);
            if (sc.Status is ServiceControllerStatus.Running or ServiceControllerStatus.StartPending) return;

            StartServiceElevated();

            for (var i = 0; i < 15; i++)
            {
                await Task.Delay(1000);
                sc.Refresh();
                if (sc.Status == ServiceControllerStatus.Running) return;
            }
        }
        catch
        {
            // Service not found or query failed: there's nothing more to do
            // here, the window will keep waiting anyway via TryNavigateWhenReadyAsync.
        }
    }

    private static void StartServiceElevated()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "sc.exe",
                Arguments = $"start {ServiceName}",
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(8000);
        }
        catch (Win32Exception)
        {
            // UAC cancelled: the service stays stopped, the network retry in
            // TryNavigateWhenReadyAsync will keep failing until it
            // starts back up (manually or by reopening the app).
        }
    }

    private static void StopServiceElevated()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "sc.exe",
                Arguments = $"stop {ServiceName}",
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(8000);
        }
        catch (Win32Exception)
        {
            // UAC cancelled by the user: the window closes anyway,
            // the service stays running (no harm, just not stopped).
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
        // The WebView2 profile can't live in the exe's folder: we're
        // inside Program Files, a normal user has no write
        // permissions there and CreateAsync fails with Access denied. An explicit
        // writable data folder is needed (the current user's AppData).
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RackTemp", "WebView2"
        );
        Directory.CreateDirectory(userDataFolder);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await _webView.EnsureCoreWebView2Async(environment);

        // Exposes the "start with Windows" toggle to the Settings page —
        // window.chrome.webview.hostObjects.racktempHost on the JS side. Works
        // only in here (this window), never from a normal browser or
        // remotely: that's exactly the intended behavior, autostart is by
        // definition a preference of this user on this machine.
        _webView.CoreWebView2.AddHostObjectToScript("racktempHost", new RackTempHostObject());

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
            return; // not ready yet, the timer will retry
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

        // Click on the X: hide instead of closing, like "tray-first" apps.
        // To really stop the service use "Exit" from the tray menu.
        e.Cancel = true;
        Hide();
        _trayIcon.ShowBalloonTip(
            3000,
            "RackTemp",
            "Still running in the background. Double-click the icon to reopen it, right-click to really exit.",
            ToolTipIcon.Info
        );
    }
}

// Object exposed to the web page via CoreWebView2.AddHostObjectToScript.
// Public methods with primitive types only — WebView2 marshals them to JS
// automatically, every call on the page side returns a Promise.
public class RackTempHostObject
{
    public bool GetAutostart() => MainForm.GetAutostart();
    public void SetAutostart(bool enable) => MainForm.SetAutostart(enable);
}

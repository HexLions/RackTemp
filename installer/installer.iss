; RackTemp for Windows — installer.
; Ships a portable Node.js runtime + the built app + nssm.exe, installs
; RackTemp as a Windows Service (LocalSystem, auto-start), and keeps its
; SQLite database in %ProgramData%\RackTemp\data so it survives reinstalls
; and version upgrades untouched.
;
; Build the "app" staging folder first with scripts\build-installer-windows.ps1
; (which also invokes this script, passing /DMyAppVersion=<backend/package.json
; version> so this installer always matches the Docker image built from the
; same commit) — do not run ISCC directly on a fresh checkout, dist-windows\app
; won't exist yet.

#define MyAppName "RackTemp"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#define MyAppPublisher "HexLions"
#define MyAppURL "https://github.com/HexLions/RackTemp"
#define MyAppExeDesc "RackTemp rack temperature monitor"
#define StagedApp "..\dist-windows\app"

[Setup]
AppId={{F7234BBD-B233-4500-B49E-1717C7498F77}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\RackTemp
DefaultGroupName=RackTemp
DisableProgramGroupPage=yes
OutputDir=..\dist-windows
OutputBaseFilename=RackTemp-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=racktemp.ico
UninstallDisplayIcon={app}\racktemp.ico

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Avvia RackTemp (finestra/tray) automaticamente all'accesso a Windows"; GroupDescription: "Opzioni aggiuntive:"

[Files]
Source: "{#StagedApp}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "racktemp.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\RackTemp\data"; Permissions: users-modify

[Icons]
Name: "{group}\RackTemp"; Filename: "{app}\tray\RackTempTray.exe"; IconFilename: "{app}\racktemp.ico"
Name: "{group}\Disinstalla RackTemp"; Filename: "{uninstallexe}"; IconFilename: "{app}\racktemp.ico"
Name: "{userstartup}\RackTemp"; Filename: "{app}\tray\RackTempTray.exe"; Parameters: "--minimized"; IconFilename: "{app}\racktemp.ico"; Tasks: autostart

[Run]
Filename: "{app}\nssm.exe"; Parameters: "install RackTemp ""{app}\node\node.exe"" ""{app}\backend\dist\index.js"""; Flags: runhidden; StatusMsg: "Registro il servizio Windows..."
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp AppDirectory ""{app}\backend"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp DisplayName ""RackTemp"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp Description ""RackTemp - monitor temperatura/umidita rack (http://localhost:7431)"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp Start SERVICE_AUTO_START"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp AppStdout ""{commonappdata}\RackTemp\service.log"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set RackTemp AppStderr ""{commonappdata}\RackTemp\service.log"""; Flags: runhidden
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""RackTemp"" dir=in action=allow protocol=TCP localport=7431"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "start RackTemp"; Flags: runhidden; StatusMsg: "Avvio il servizio RackTemp..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile '{tmp}\MicrosoftEdgeWebView2Setup.exe'; Start-Process -FilePath '{tmp}\MicrosoftEdgeWebView2Setup.exe' -ArgumentList '/silent /install' -Wait"""; StatusMsg: "Installo Microsoft Edge WebView2 (serve alla finestra di RackTemp)..."; Flags: runhidden; Check: WebView2Missing
Filename: "{app}\tray\RackTempTray.exe"; Description: "Avvia RackTemp"; Flags: postinstall skipifsilent nowait

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop RackTemp"; Flags: runhidden; RunOnceId: "StopRackTemp"
Filename: "{app}\nssm.exe"; Parameters: "remove RackTemp confirm"; Flags: runhidden; RunOnceId: "RemoveRackTemp"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""RackTemp"""; Flags: runhidden; RunOnceId: "RemoveFirewallRule"

[Code]
function GenerateRandomString(Len: Integer): String;
var
  Chars: String;
  I: Integer;
begin
  Chars := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  Result := '';
  for I := 1 to Len do
    Result := Result + Chars[Random(Length(Chars)) + 1];
end;

// Rilevamento standard Microsoft: il runtime WebView2 (Evergreen) scrive la
// propria versione in una di queste chiavi. Se assente/vuota/0.0.0.0, il
// componente non è installato e va scaricato prima che la finestra tray
// possa mostrare qualcosa.
function WebView2Missing(): Boolean;
var
  Version, ClientKey, ClientKeyWow: String;
begin
  ClientKey := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  ClientKeyWow := 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := True;
  if RegQueryStringValue(HKLM, ClientKeyWow, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0') then
    Result := False
  else if RegQueryStringValue(HKLM, ClientKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0') then
    Result := False
  else if RegQueryStringValue(HKCU, ClientKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0') then
    Result := False;
end;

procedure WriteEnvFileIfMissing;
var
  EnvPath: String;
  DataDir: String;
  Content: String;
begin
  EnvPath := ExpandConstant('{app}\backend\.env');
  if not FileExists(EnvPath) then
  begin
    DataDir := ExpandConstant('{commonappdata}\RackTemp\data');
    StringChangeEx(DataDir, '\', '/', True);
    Content := 'PORT=7431' + #13#10 +
      'DATABASE_URL=file:' + DataDir + '/db.sqlite' + #13#10 +
      'SESSION_SECRET=' + GenerateRandomString(48) + #13#10 +
      'DEPLOY_TARGET=windows' + #13#10;
    SaveStringToFile(EnvPath, Content, False);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteEnvFileIfMissing;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if MsgBox('Vuoi mantenere i dati (letture, sensori, soglie, login) in ' + ExpandConstant('{commonappdata}') + '\RackTemp\data ?' + #13#10 + #13#10 +
     'Si = mantieni i dati (consigliato, utile se reinstalli dopo).' + #13#10 +
     'No = cancella tutto insieme al programma.',
     mbConfirmation, MB_YESNO) = IDNO then
  begin
    DelTree(ExpandConstant('{commonappdata}\RackTemp'), True, True, True);
  end;
end;

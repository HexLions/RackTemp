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
UninstallDisplayIcon={app}\node\node.exe

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#StagedApp}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Dirs]
Name: "{commonappdata}\RackTemp\data"; Permissions: users-modify

[Icons]
Name: "{group}\RackTemp"; Filename: "{app}\racktemp.url"
Name: "{group}\Disinstalla RackTemp"; Filename: "{uninstallexe}"

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
Filename: "http://localhost:7431"; Description: "Apri RackTemp nel browser"; Flags: postinstall shellexec skipifsilent

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

procedure CreateUrlShortcut;
var
  UrlFile: String;
begin
  UrlFile := ExpandConstant('{app}\racktemp.url');
  SaveStringToFile(UrlFile, '[InternetShortcut]' + #13#10 + 'URL=http://localhost:7431' + #13#10, False);
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
    CreateUrlShortcut;
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

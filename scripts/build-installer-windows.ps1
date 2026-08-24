# Builds backend + frontend + the WebView2 tray shell, stages a self-
# contained app folder (portable Node.js runtime + compiled app + nssm.exe
# + tray exe), then compiles the Inno Setup installer. Run from anywhere;
# paths are resolved relative to this script.
#
# Requirements on the BUILD machine only: Node.js + npm, .NET 8 SDK, Inno
# Setup 6 (ISCC.exe). The machine that RUNS the installer needs none of
# these — that's the point, everything ships inside the installer (the
# WebView2 *runtime* itself is the one exception: the installer fetches it
# on the target machine at install time if missing, see installer.iss).

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$tray = Join-Path $root "windows-tray\RackTempTray"
$tools = Join-Path $root "tools"
$stage = Join-Path $root "dist-windows\app"
$outDir = Join-Path $root "dist-windows"

$nodeVersion = "20.18.1"
$nodeDirName = "node-v$nodeVersion-win-x64"
$nssmVersion = "2.24"
$nssmDirName = "nssm-$nssmVersion"

function Get-ISCC {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $found = Get-ChildItem -Path "$env:LOCALAPPDATA\Programs","C:\Program Files*" -Filter ISCC.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "ISCC.exe not found. Install Inno Setup 6 (winget install JRSoftware.InnoSetup) and retry."
}

Write-Host "== 1/6: backend build ==" -ForegroundColor Cyan
Push-Location $backend
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci (backend) failed" }
npx prisma generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
Pop-Location

Write-Host "== 2/6: frontend build ==" -ForegroundColor Cyan
Push-Location $frontend
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci (frontend) failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Pop-Location

Write-Host "== 3/7: tray shell build (WebView2 window) ==" -ForegroundColor Cyan
Push-Location $tray
dotnet publish -c Release -r win-x64 --self-contained true -o (Join-Path $root "dist-windows\tray-publish")
if ($LASTEXITCODE -ne 0) { throw "tray app publish failed" }
Pop-Location

Write-Host "== 4/7: portable Node.js runtime ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$nodeZip = Join-Path $tools "$nodeDirName.zip"
$nodeDir = Join-Path $tools $nodeDirName
if (-not (Test-Path $nodeDir)) {
    if (-not (Test-Path $nodeZip)) {
        Write-Host "Downloading Node.js $nodeVersion..."
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/$nodeDirName.zip" -OutFile $nodeZip
    }
    Expand-Archive -Path $nodeZip -DestinationPath $tools -Force
}

Write-Host "== 5/7: nssm (Windows service wrapper) ==" -ForegroundColor Cyan
$nssmZip = Join-Path $tools "$nssmDirName.zip"
$nssmDir = Join-Path $tools $nssmDirName
if (-not (Test-Path $nssmDir)) {
    if (-not (Test-Path $nssmZip)) {
        Write-Host "Downloading nssm $nssmVersion..."
        Invoke-WebRequest -Uri "https://nssm.cc/release/$nssmDirName.zip" -OutFile $nssmZip
    }
    Expand-Archive -Path $nssmZip -DestinationPath $tools -Force
}

Write-Host "== 6/7: staging app folder ==" -ForegroundColor Cyan
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

New-Item -ItemType Directory -Force -Path (Join-Path $stage "node") | Out-Null
Copy-Item (Join-Path $nodeDir "*") (Join-Path $stage "node") -Recurse -Force

New-Item -ItemType Directory -Force -Path (Join-Path $stage "backend") | Out-Null
Copy-Item (Join-Path $backend "dist") (Join-Path $stage "backend\dist") -Recurse -Force
Copy-Item (Join-Path $backend "public") (Join-Path $stage "backend\public") -Recurse -Force
Copy-Item (Join-Path $backend "node_modules") (Join-Path $stage "backend\node_modules") -Recurse -Force
Copy-Item (Join-Path $backend "prisma") (Join-Path $stage "backend\prisma") -Recurse -Force
Copy-Item (Join-Path $backend "package.json") (Join-Path $stage "backend\package.json") -Force

Copy-Item (Join-Path $nssmDir "win64\nssm.exe") (Join-Path $stage "nssm.exe") -Force

New-Item -ItemType Directory -Force -Path (Join-Path $stage "tray") | Out-Null
Copy-Item (Join-Path $root "dist-windows\tray-publish\*") (Join-Path $stage "tray") -Recurse -Force

Write-Host "== 7/7: compiling installer ==" -ForegroundColor Cyan
$pkgVersion = (Get-Content (Join-Path $backend "package.json") -Raw | ConvertFrom-Json).version
Write-Host "App version: $pkgVersion (from backend\package.json)"
$iscc = Get-ISCC
& $iscc "/DMyAppVersion=$pkgVersion" (Join-Path $root "installer\installer.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC compile failed" }

Write-Host ""
Write-Host "Done. Installer in $outDir" -ForegroundColor Green
Get-ChildItem $outDir -Filter "*.exe" | ForEach-Object { Write-Host " -> $($_.FullName)" }

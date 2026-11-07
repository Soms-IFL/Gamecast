# IFL Simulator - Windows setup
# Run it by double-clicking setup.bat (or: powershell -ExecutionPolicy Bypass -File setup-windows.ps1)
# Optional switches for unattended use:  -Port 3000 -Password "secret" -Yes
param(
  [int]$Port = 0,
  [string]$Password = '',
  [switch]$Yes,          # accept the default answer to every question
  [switch]$NoStart,      # don't start the server at the end
  [switch]$NoFirewall    # skip the firewall step
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Root = $PSScriptRoot
$DataDir = Join-Path $Root 'data'
$ConfigFile = Join-Path $DataDir 'config.json'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Ask($question, $default) {
  if ($Yes) { return $default }
  $a = Read-Host "$question [$default]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function AskYesNo($question, [bool]$default = $true) {
  if ($Yes) { return $default }
  $hint = if ($default) { 'Y/n' } else { 'y/N' }
  $a = Read-Host "$question [$hint]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim().ToLower().StartsWith('y')
}
function Get-NodeMajor {
  try { $v = & node --version 2>$null; if ($v -match '^v(\d+)') { return [int]$Matches[1] } } catch {}
  return 0
}

Say ''
Say '  ==============================================' Cyan
Say '    IFL Simulator - International Football League' Cyan
Say '    Windows setup' Cyan
Say '  ==============================================' Cyan
Say ''

# ---------------------------------------------------------------- 1. Node.js
Say '[1/4] Checking for Node.js...' White
$major = Get-NodeMajor
if ($major -ge 18) {
  Say "      Found Node.js v$major. Good." Green
} else {
  if ($major -gt 0) { Say "      Node.js v$major is too old (need 18 or newer)." Yellow } else { Say '      Node.js is not installed.' Yellow }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget -and (AskYesNo '      Install Node.js LTS now using winget (Windows Package Manager)?' $true)) {
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # pick up the new PATH without reopening the window
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $major = Get-NodeMajor
  }
  if ($major -lt 18) {
    Say ''
    Say '      Could not install Node.js automatically.' Red
    Say '      Install the "LTS" version from https://nodejs.org, then run setup.bat again.' Red
    Start-Process 'https://nodejs.org'
    exit 1
  }
  Say "      Node.js v$major installed." Green
}

# ---------------------------------------------------------------- 2. Settings
Say ''
Say '[2/4] Settings' White
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$cfg = @{}
if (Test-Path $ConfigFile) {
  try {
    $old = Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
  } catch { Say '      (Existing config.json could not be read; making a new one.)' Yellow }
}
$defPort = if ($cfg.ContainsKey('port') -and $cfg.port) { [int]$cfg.port } else { 3000 }
if ($Port -le 0) {
  while ($true) {
    $p = Ask '      Port for the website' $defPort
    if ($p -match '^\d+$' -and [int]$p -ge 1 -and [int]$p -le 65535) { $Port = [int]$p; break }
    Say '      Please enter a number between 1 and 65535.' Yellow
  }
}
$cfg.port = $Port
$cfg.host = '0.0.0.0'

if ($Password) {
  $cfg.adminPassword = $Password
} elseif ($cfg.ContainsKey('adminPassword') -and $cfg.adminPassword -and (AskYesNo '      Keep the current admin password?' $true)) {
  # keep it
} else {
  $pw = if ($Yes) { '' } else { Read-Host '      Choose an admin password (leave empty to generate one)' }
  if ([string]::IsNullOrWhiteSpace($pw)) {
    $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    $pw = -join (1..12 | ForEach-Object { $chars | Get-Random })
    Say "      Generated admin password: $pw" Green
  }
  $cfg.adminPassword = $pw.Trim()
}
# write UTF-8 without BOM so Node reads it cleanly
$json = [pscustomobject]$cfg | ConvertTo-Json
[System.IO.File]::WriteAllText($ConfigFile, $json, (New-Object System.Text.UTF8Encoding $false))
Say "      Saved to data\config.json" Green

# start script
$startBat = Join-Path $Root 'start-ifl.bat'
$bat = "@echo off`r`ncd /d `"%~dp0`"`r`ntitle IFL Simulator`r`necho Starting the IFL Simulator. Keep this window open while the league is running.`r`nnode server.js`r`necho.`r`necho The server stopped.`r`npause`r`n"
[System.IO.File]::WriteAllText($startBat, $bat, (New-Object System.Text.ASCIIEncoding))
Say '      Created start-ifl.bat (double-click it to start the league).' Green

# ---------------------------------------------------------------- 3. Network access
Say ''
Say '[3/4] Network access' White
Say '      Windows may block other devices from reaching the site until a firewall rule is added.'
if (-not $NoFirewall -and (AskYesNo "      Add a firewall rule for port $Port (private networks only)? Needs admin approval" $true)) {
  $cmd = "if (-not (Get-NetFirewallRule -DisplayName 'IFL Simulator' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'IFL Simulator' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null } else { Set-NetFirewallRule -DisplayName 'IFL Simulator' -LocalPort $Port }"
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $cmd
    Say "      Firewall rule added for TCP port $Port." Green
  } catch {
    Say '      Skipped (admin approval was not given).' Yellow
  }
}

# ---------------------------------------------------------------- 4. Auto start
Say ''
Say '[4/4] Starting automatically' White
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'IFL Simulator.lnk'
if (AskYesNo '      Start the league automatically when you log in to Windows?' $false) {
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($lnkPath)
  $lnk.TargetPath = $startBat
  $lnk.WorkingDirectory = $Root
  $lnk.WindowStyle = 7   # minimized
  $lnk.Description = 'IFL Simulator server'
  $lnk.Save()
  Say '      Added to your Startup folder.' Green
} elseif (Test-Path $lnkPath) {
  if (AskYesNo '      Remove the existing auto-start shortcut?' $false) { Remove-Item -LiteralPath $lnkPath; Say '      Removed.' Green }
}

# ---------------------------------------------------------------- Done
$ips = @()
try { $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress } catch {}
Say ''
Say '  Setup complete!' Green
Say ''
Say "    Open the league:        http://localhost:$Port"
foreach ($ip in $ips) { Say "    Friends on your network: http://${ip}:$Port" }
Say "    Admin password:          saved in data\config.json"
Say '    Start it later:          double-click start-ifl.bat'
Say "    Friends over the internet: forward TCP port $Port on your router to this PC (see README)."
Say ''
if (-not $NoStart -and (AskYesNo '  Start the league now?' $true)) {
  Start-Process -FilePath $startBat -WorkingDirectory $Root
  Start-Sleep -Seconds 3
  Start-Process "http://localhost:$Port"
}

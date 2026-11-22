# BITS reports: one command to set up (first run) and start everything on Windows.
# Easiest: double-click start.bat. Or in PowerShell:  .\start.bat   /   .\start.bat -Local
#   .\start.bat -Classic   also starts the old (classic) frontend on http://localhost:3001
# The app is the glass frontend (frontend-next) on http://localhost:3000; the classic frontend
# (frontend\) is kept as a backup and only starts with -Classic.
# First run creates the .env files from the .env.example files, makes the Python environment,
# installs packages and starts MongoDB if it can.
param([switch]$Local, [switch]$Classic)

# 'Continue': Windows PowerShell 5.1 would otherwise abort whenever a tool prints a warning.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$Root = $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$Root\logs" | Out-Null

function Say($msg)  { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }
function Fail($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Red; exit 1 }
function EnvValue($file, $key) {
  if (-not (Test-Path $file)) { return '' }
  $line = Get-Content $file | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return ($line -replace "^$key=", '').Trim().Trim('"').Trim("'")
}
function PortOpen($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $r = $c.BeginConnect('127.0.0.1', $port, $null, $null); return ($r.AsyncWaitHandle.WaitOne(500) -and $c.Connected) }
  catch { return $false } finally { $c.Close() }
}
function FreePort($port) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $owners) {
    if ($p -gt 0) { Write-Host "Port $port was in use by an old run; closing it."; & taskkill /PID $p /T /F 2>$null | Out-Null }
  }
}

# ---------------------------------------------------------------- tools
$Py = $null
foreach ($cand in @('py -3.12', 'py -3', 'python')) {
  $parts = $cand.Split(' ')
  $exe = $parts[0]; $pre = @($parts | Select-Object -Skip 1)
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
  try {
    & $exe @pre -c "import sys; sys.exit(sys.version_info < (3, 10))" 2>$null
    if ($LASTEXITCODE -eq 0) { $Py = $parts; break }
  } catch {}
}
if (-not $Py) { Fail "Python 3.10 or newer is needed. Install Python 3.12 from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run start.bat again." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail "Node.js is needed. Install the LTS version from https://nodejs.org, then run start.bat again." }
$PyExe = $Py[0]; $PyPre = @($Py | Select-Object -Skip 1)

# ---------------------------------------------------------------- settings files
if (-not (Test-Path 'backend\.env')) {
  Say 'Creating backend\.env from backend\.env.example'
  $secret = & $PyExe @PyPre -c "import secrets; print(secrets.token_urlsafe(48))"
  $text = (Get-Content 'backend\.env.example' -Raw) -replace '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secret"
  [IO.File]::WriteAllText("$Root\backend\.env", $text)
}
if (-not (Test-Path 'frontend-next\.env')) { Say 'Creating frontend-next\.env'; Copy-Item 'frontend-next\.env.example' 'frontend-next\.env' }
if ($Classic -and -not (Test-Path 'frontend\.env')) { Say 'Creating frontend\.env'; Copy-Item 'frontend\.env.example' 'frontend\.env' }

# ---------------------------------------------------------------- backend packages
$VenvPy = "$Root\backend\.venv\Scripts\python.exe"
$venvOk = $false
if (Test-Path $VenvPy) { try { & $VenvPy -c "import sys" 2>$null; $venvOk = ($LASTEXITCODE -eq 0) } catch {} }
if (-not $venvOk) {
  # Missing, or copied from another computer (a Mac's environment never works here).
  Say 'Creating the backend Python environment (first run only)'
  if (Test-Path 'backend\.venv') { Remove-Item -Recurse -Force 'backend\.venv' }
  & $PyExe @PyPre -m venv 'backend\.venv'
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create backend\.venv' }
}
$reqStamp = 'backend\.venv\.installed-requirements'
if (-not (Test-Path $reqStamp) -or ((Get-Content 'backend\requirements.txt' -Raw) -ne (Get-Content $reqStamp -Raw))) {
  Say 'Installing backend packages'
  & $VenvPy -m pip install --upgrade pip -q
  & $VenvPy -m pip install -r 'backend\requirements.txt'
  if ($LASTEXITCODE -ne 0) { Fail 'Backend package install failed (see above).' }
  Copy-Item 'backend\requirements.txt' $reqStamp
}

# ---------------------------------------------------------------- frontend packages
function InstallPackages($dir, $label) {
  # A Windows-only stamp: node_modules copied from a Mac has the wrong native build tools
  # (esbuild, rollup), so it is replaced instead of reused.
  $stamp = "$dir\node_modules\.installed-package-windows.json"
  if (-not (Test-Path $stamp) -or ((Get-Content "$dir\package.json" -Raw) -ne (Get-Content $stamp -Raw))) {
    if ((Test-Path "$dir\node_modules") -and -not (Test-Path $stamp)) {
      Say "Removing $label packages copied from another computer"
      Remove-Item -Recurse -Force "$dir\node_modules" -ErrorAction SilentlyContinue
    }
    Say "Installing $label packages (takes a few minutes the first time)"
    Push-Location $dir
    & npm.cmd install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "$label package install failed (see above)." }
    Copy-Item "$dir\package.json" $stamp
  }
}
InstallPackages 'frontend-next' 'frontend'
if ($Classic) { InstallPackages 'frontend' 'classic frontend' }

# ---------------------------------------------------------------- MongoDB
$mongoUrl = EnvValue 'backend\.env' 'MONGO_URL'
if (($mongoUrl -eq '' -or $mongoUrl -match 'localhost|127\.0\.0\.1') -and -not (PortOpen 27017)) {
  Say 'MongoDB is not running; trying to start it'
  $svc = Get-Service -Name 'MongoDB*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($svc) {
    try { Start-Service $svc.Name -ErrorAction Stop } catch { Write-Host "Could not start the $($svc.Name) service: run start.bat as administrator once, or start it in Services." }
  } elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker start bits-mongo 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { & docker run -d --name bits-mongo -p 27017:27017 -v bits-mongo-data:/data/db mongo:7 | Out-Null }
  }
  for ($i = 0; $i -lt 20 -and -not (PortOpen 27017); $i++) { Start-Sleep 1 }
  if (-not (PortOpen 27017)) {
    Fail ("MongoDB is not installed. Install MongoDB Community Server once (keep 'Install MongoD as a Service' ticked):`n" +
          "  https://www.mongodb.com/try/download/community   or:   winget install MongoDB.Server`n" +
          "(or install Docker Desktop and this script will run MongoDB in Docker for you). Then run start.bat again.")
  }
}

# ---------------------------------------------------------------- start
FreePort 8000; FreePort 3000; FreePort 5173; if ($Classic) { FreePort 3001 }; if (-not $Local) { FreePort 4040 }

Say 'Starting backend  (http://localhost:8000) in its own window'
$backend = Start-Process -FilePath $VenvPy -WorkingDirectory "$Root\backend" -PassThru `
  -ArgumentList @('-m', 'uvicorn', 'server:app', '--host', '0.0.0.0', '--port', '8000', '--reload')

Say 'Starting frontend (http://localhost:3000) in its own window'
$frontend = Start-Process -FilePath 'cmd.exe' -WorkingDirectory "$Root\frontend-next" -PassThru -ArgumentList @('/c', 'npx vite --port 3000 --strictPort')
$classicApp = $null
if ($Classic) {
  Say 'Starting the classic frontend (http://localhost:3001) in its own window'
  $env:BROWSER = 'none'; $env:PORT = '3001'
  $classicApp = Start-Process -FilePath 'cmd.exe' -WorkingDirectory "$Root\frontend" -PassThru -ArgumentList @('/c', 'npm start')
  Remove-Item Env:PORT
}

# ---------------------------------------------------------------- ngrok
$ngrok = $null; $PublicUrl = ''
function StartNgrok($url) {
  $ngArgs = @('http', '3000', '--log=stdout')
  if ($url) { $ngArgs += "--url=$url" }
  $script:ngrok = Start-Process -FilePath 'ngrok' -ArgumentList $ngArgs -PassThru -NoNewWindow `
    -RedirectStandardOutput "$Root\logs\ngrok.log" -RedirectStandardError "$Root\logs\ngrok-errors.log"
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep 1
    if ($script:ngrok.HasExited) { return '' }
    try {
      $t = (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels | Where-Object { $_.public_url -like 'https*' } | Select-Object -First 1
      if ($t) { return $t.public_url }
    } catch {}
  }
  return ''
}
if (-not $Local) {
  if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host '(ngrok is not installed, so there is no public link. Optional: winget install ngrok.ngrok, then'
    Write-Host ' ngrok config add-authtoken <token from dashboard.ngrok.com>.)'
  } else {
    $pinned = EnvValue '.env' 'NGROK_URL'
    $PublicUrl = StartNgrok $pinned
    if (-not $PublicUrl -and $pinned) {
      # A pinned address from someone else's ngrok account fails; use this account's own address.
      if ($ngrok -and -not $ngrok.HasExited) { Stop-Process -Id $ngrok.Id -Force }
      $PublicUrl = StartNgrok ''
    }
    if ($PublicUrl) { Set-Content "$Root\logs\public-url.txt" $PublicUrl }
    else {
      Write-Host 'ngrok could not start. Last lines of logs\ngrok.log:'
      Get-Content "$Root\logs\ngrok.log", "$Root\logs\ngrok-errors.log" -ErrorAction SilentlyContinue | Select-Object -Last 5
      Write-Host '(If it mentions an authtoken: ngrok config add-authtoken <token from dashboard.ngrok.com>)'
    }
  }
}

Write-Host ''
Write-Host 'Waiting for the website to finish building...'
for ($i = 0; $i -lt 180; $i++) {
  try { Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 }
}

Write-Host ''
Write-Host '==================================================================' -ForegroundColor Green
Write-Host '  BITS reports is running'
Write-Host '  On this computer:  http://localhost:3000'
if ($Classic) { Write-Host '  Classic app:       http://localhost:3001' }
if ($PublicUrl) {
  Write-Host "  Public link:       $PublicUrl"
  Write-Host '  Google sign-in on the public link needs this address registered once'
  Write-Host "  (Google Cloud Console > Authorized redirect URIs):  $PublicUrl/login"
}
Write-Host '  Backend and frontend logs are in their own windows.'
Write-Host '==================================================================' -ForegroundColor Green
Start-Process 'http://localhost:3000'
Read-Host 'Press Enter here to stop everything'

foreach ($p in @($backend, $frontend, $classicApp, $ngrok)) {
  if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null }
}
FreePort 8000; FreePort 3000; if ($Classic) { FreePort 3001 }
Write-Host 'Stopped.'

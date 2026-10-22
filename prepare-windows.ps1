$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$upstream = Join-Path $root 'upstream'
$assets = Join-Path $root 'android\app\src\main\assets'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git for Windows required' }
if (-not (Test-Path (Join-Path $upstream '.git'))) {
  & git clone --depth=1 https://github.com/rfaile313/samsucks.git $upstream
  if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
}
if (Get-Command py -ErrorAction SilentlyContinue) {
  & py -3 (Join-Path $root 'patches\apply.py') $upstream $assets
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  & python (Join-Path $root 'patches\apply.py') $upstream $assets
} else { throw 'Python 3 is required' }
if ($LASTEXITCODE -ne 0) { throw 'Asset preparation failed' }
Write-Host 'HumaxPlex ready: open android folder in Android Studio.' -ForegroundColor Green

# Start main quick tunnel → http://127.0.0.1:3000
# Usage (repo root): powershell -File tools/cloudflared/start-main-tunnel.ps1
# Install cloudflared from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
# Do not commit cloudflared*.exe into this repository.
$ErrorActionPreference = "Stop"

function Resolve-Cloudflared {
  $local = Join-Path $PSScriptRoot "cloudflared-windows-amd64.exe"
  if (Test-Path $local) { return $local }
  $fromPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }
  Write-Error @"
cloudflared not found.
Install from Cloudflare docs, or place cloudflared-windows-amd64.exe in tools/cloudflared/ (gitignored).
"@
}

$cf = Resolve-Cloudflared
Write-Host "Starting tunnel → http://127.0.0.1:3000 (using $cf)"
Write-Host "After the URL prints: put it in TUNNEL_URL in .env (origin only) and restart the API only."
& $cf tunnel --url http://127.0.0.1:3000 --no-autoupdate

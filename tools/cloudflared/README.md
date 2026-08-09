# Cloudflared (optional)

Use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) when you need a public HTTPS origin for local auth/cookies.

**Do not commit** `cloudflared*.exe` or tunnel logs. Install the CLI from Cloudflare and keep it on your `PATH`, or place the binary next to the script (it stays gitignored).

```powershell
# From repo root, after installing cloudflared:
powershell -File tools/cloudflared/start-main-tunnel.ps1
```

Paste the printed `https://….trycloudflare.com` origin into `TUNNEL_URL` in the root `.env`, then restart the **API only**. See [docs/SETUP.md](../../docs/SETUP.md).

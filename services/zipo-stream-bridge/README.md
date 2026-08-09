# ZiPo Stream Bridge

Serviço Python interno que extrai streams HLS/DASH dos provedores de embed
(SuperFlix / WarezCDN), transcodifica via FFmpeg (NVENC no Windows quando
disponível) e publica HLS VOD no MinIO para o player nativo ZiPo + sync Cinema.

**Não** remove controles de anúncios, usa proxies rotativos ou aceita URLs arbitrárias —
veja `docs/AUTHORIZED_MEDIA_RESOLVER.md`.

## Requisitos

- Python 3.11+
- FFmpeg no `PATH` (ou `FFMPEG_PATH` / `FFPROBE_PATH` no `.env` raiz)
- MinIO/S3 (`pnpm dev:deps`)
- API ZiPo rodando (resolução de IDs via `/api/v1/content/...`)
- Provedores habilitados: `SUPERFLIX_ENABLED=true` e/ou `WAREZCDN_ENABLED=true`

## Setup (Windows)

```powershell
cd D:\projects\Zipo\services\zipo-stream-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Configure no `.env` raiz do monorepo:

```env
STREAM_BRIDGE_ENABLED=true
STREAM_BRIDGE_URL=http://localhost:8090
STREAM_BRIDGE_SECRET=change-me-to-an-independent-random-32-char-secret
# Optional: exact licensed CDN hosts; use `.example.com` only to allow its subdomains.
STREAM_BRIDGE_ALLOWED_MEDIA_HOSTS=
SUPERFLIX_ENABLED=true
MEDIA_WORKER_ENABLED=true
MEDIA_PREPARATION_ENABLED=true
EMBED_CINEMA_CHAT_ONLY=false
```

## Executar

```powershell
# via pnpm na raiz
pnpm stream-bridge:dev

# ou diretamente
python app.py
```

Health: `GET http://localhost:8090/health`

## CLI (dev)

```powershell
python cli.py --type movie --id tt0111161 --quality 720
```

## API interna

| Método | Rota | Auth |
|--------|------|------|
| POST | `/v1/prepare` | header `X-ZiPo-Bridge-Secret` |
| GET | `/v1/prepare/{jobId}` | idem |

Body `POST /v1/prepare`:

```json
{
  "contentType": "movie",
  "contentId": "tt0111161",
  "qualities": [480, 720, 1080]
}
```

Saída MinIO: `playback-cache/cinema/{jobId}/master.m3u8`

Jobs são persistidos em SQLite (`STREAM_BRIDGE_JOB_DB`), limitados por
`STREAM_BRIDGE_MAX_ACTIVE_JOBS` e `STREAM_BRIDGE_MAX_JOB_RECORDS`. Um restart
marca jobs incompletos como falhos para permitir retry explícito e seguro.

## Saída de rede e SSRF

O bridge aceita apenas URLs HTTPS em hosts explicitamente permitidos. Cada salto
de redirecionamento é validado, credenciais embutidas na URL são rejeitadas e o
DNS deve resolver exclusivamente para endereços IP públicos. Entradas em
`STREAM_BRIDGE_ALLOWED_MEDIA_HOSTS` são hosts exatos; um ponto inicial, como
`.media.example.com`, permite também os subdomínios.

Esta validação de aplicação não substitui isolamento de rede. Em produção, rode
o bridge em uma rede dedicada e aplique uma política de egress que bloqueie
loopback, redes privadas, link-local e endpoints de metadata da nuvem. Não
habilite um domínio amplo quando os hosts de mídia exatos são conhecidos.

## NVENC

Verifique suporte:

```powershell
ffmpeg -encoders | findstr nvenc
```

Se indisponível, o bridge usa `libx264` automaticamente.

## Testes

```powershell
python -m pytest tests -q
```

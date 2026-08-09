# Cinema ZiPo — chat + presença (fase 1)

**Data:** 2026-07-24  
**Status:** aprovado / implementado

## Meta

Habilitar Cinema com **chat + presença** agora. Sync de vídeo / player nativo fica para quando houver mídia controlada (`AUTHORIZED_MEDIA` ou prep nativa).

## Flags

| Flag | Valor fase 1 |
|------|----------------|
| `CINEMA_ENABLED` | `true` |
| `NEXT_PUBLIC_CINEMA_ENABLED` | `true` |
| `EMBED_CINEMA_CHAT_ONLY` | `true` |
| `NEXT_PUBLIC_EMBED_CINEMA_CHAT_ONLY` | `true` |

## Comportamento

- **Permitido:** criar/entrar sala, heartbeat/presença, chat texto, mute/kick/delete-message, copiar link.
- **Bloqueado (API):** `play` / `pause` / `seek` / `rate` / `episode` / `server`, print, clip; Stream Bridge não dispara ao criar sala.
- **UI:** sem player nem controles de sync; card do título + lista online + chat.

## Fora de escopo

- Bypass / extração HLS de embeds de terceiros
- Playback nativo sincronizado (fase 2: `EMBED_CINEMA_CHAT_ONLY=false` + fonte autorizada)

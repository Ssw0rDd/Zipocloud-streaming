# MegaFlix gateway v2

Player prioritário para mídia que o operador do ZiPo possui ou está licenciado a distribuir.
Ele não integra automaticamente o executável instalado, não contorna DRM/anúncios e não aceita
origens arbitrárias. Sem gateway e CDN autorizados, fica desativado e os providers atuais seguem
como fallback.

## ZiPo

```env
MEGAFLIX_GATEWAY_ENABLED=true
MEGAFLIX_GATEWAY_URL=https://gateway.example.com/internal/v2/playback/resolve
MEGAFLIX_GATEWAY_SECRET=<segredo-aleatorio-exclusivo-com-32-ou-mais-caracteres>
MEGAFLIX_MEDIA_ORIGINS=https://media.example.com,https://cdn.example.com
MEGAFLIX_GATEWAY_TIMEOUT_MS=8000
PLAYBACK_SESSION_SECRET=<outro-segredo-aleatorio>
```

As origens são exatas, HTTPS, sem path/query/credenciais/wildcards. Quando configurado, `megaflix`
é o Player 1. A URL remota nunca é enviada ao cliente: o backend cria uma sessão Redis criptografada
e responde com `/api/v1/playback/media/authorized/...`.

## Requisição assinada

`POST` para a URL fixa, JSON bruto:

```json
{
  "version": 2,
  "requestId": "id-aleatorio",
  "content": {
    "type": "series",
    "id": "tt0944947",
    "title": "Example",
    "imdbId": "tt0944947",
    "tmdbId": 1399,
    "season": 1,
    "episode": 1
  },
  "preferences": {
    "audioLanguage": "pt-BR",
    "subtitleLanguage": "pt-BR"
  }
}
```

Headers:

```text
X-ZiPo-Timestamp: <Unix milliseconds, 13 dígitos>
X-ZiPo-Nonce: <nonce aleatório>
X-ZiPo-Signature: base64url(HMAC-SHA256(secret, request:timestamp:nonce:rawBody))
```

O gateway deve validar janela de tempo, rejeitar replay do nonce, comparar HMAC em tempo constante,
autorizar o título/episódio e limitar a resposta.

## Resposta

```json
{
  "version": 2,
  "sources": [
    {
      "type": "hls",
      "url": "https://media.example.com/title/master.m3u8?token=curto",
      "label": "MegaFlix BR",
      "quality": "1080p",
      "language": "pt-BR",
      "expiresAt": "2026-07-30T23:00:00.000Z"
    }
  ]
}
```

```text
X-ZiPo-Response-Signature: base64url(HMAC-SHA256(secret, response:requestTimestamp:requestNonce:rawResponseBody))
```

Somente HLS/MP4, no máximo 12 fontes. ZiPo valida HMAC, schema estrito, tamanho, DNS público,
origem exata, manifestos e MIME; redirects ficam bloqueados.

## Recuperação do player

O cliente tenta recuperar erros de rede/mídia do HLS, renova a sessão antes de expirar, preserva
o tempo atual, tenta novamente uma vez e então troca para o próximo provider. Falhas são deduplicadas
e atualizam a saúde do provider.

# Authorized media resolver

This integration is only for media owned by ZiPo or licensed for distribution.
It does not accept iframe URLs, arbitrary request headers, DRM removal, ad
removal, or client-supplied upstream URLs.

## Configuration

```env
AUTHORIZED_MEDIA_ENABLED=true
AUTHORIZED_MEDIA_RESOLVER_URL=https://resolver.example.com/v1/resolve
AUTHORIZED_MEDIA_RESOLVER_SECRET=<random-secret-with-at-least-32-characters>
AUTHORIZED_MEDIA_ORIGINS=https://media.example.com,https://cdn.example.com
AUTHORIZED_MEDIA_TIMEOUT_MS=5000
```

`AUTHORIZED_MEDIA_ORIGINS` is an exact HTTPS origin allowlist. Paths, query
strings, credentials, wildcards, private IPs and subdomain matching are not
accepted. Keep `CORS_ORIGINS` restricted to ZiPo web origins; native apps must
use normal authentication and must never receive the resolver secret.

## Scale / CDN

For thousands of concurrent viewers, point `AUTHORIZED_MEDIA_ORIGINS` at your
CDN (or origin fronted by a CDN). The current secure mode proxies HLS/MP4 through
same-origin ZiPo routes so upstream signed URLs never reach the browser. Size the
API/egress tier accordingly or move the opaque proxy contract to a dedicated edge
service; ZiPo is not a transcoder or origin storage service.

Multi-replica API is safe: playback sessions live in Redis. Background interval
jobs elect a single Redis leader so catalog sync / views flush / cleanup do not
run N times.

## Request contract

ZiPo sends `POST` JSON to the fixed resolver URL with these headers:

```text
X-ZiPo-Timestamp: <13 digit Unix milliseconds>
X-ZiPo-Nonce: <random 24 character nonce>
X-ZiPo-Signature: base64url(HMAC-SHA256(secret, request:timestamp:nonce:rawBody))
```

Example body:

```json
{
  "version": 1,
  "content": {
    "type": "movie",
    "id": "tt0111161",
    "imdbId": "tt0111161",
    "tmdbId": 278,
    "title": "The Shawshank Redemption",
    "year": 1994
  },
  "preferences": {
    "audioLanguage": "pt-BR",
    "subtitleLanguage": "pt-BR"
  }
}
```

The resolver must reject timestamps outside a short window, store each nonce
until that window expires, compare signatures in constant time, and authorize
the requested title before returning a source.

## Response contract

The resolver returns HTTP 200 JSON and:

```text
X-ZiPo-Response-Signature: base64url(HMAC-SHA256(secret, response:requestTimestamp:requestNonce:rawResponseBody))
```

```json
{
  "sources": [
    {
      "type": "hls",
      "url": "https://media.example.com/title/master.m3u8?token=short-lived",
      "label": "ZiPo PT-BR",
      "quality": "1080p",
      "language": "pt-BR",
      "expiresAt": "2026-07-21T06:00:00.000Z"
    }
  ]
}
```

Only `hls` and `mp4` are accepted. ZiPo validates the response schema and HMAC,
rejects redirects, limits response sizes, encrypts source data in Redis, and
exposes only same-origin `/api/v1/playback/media/authorized/...` URLs. HLS
resource URLs are AES-GCM encrypted before reaching the browser. MP4 range
requests are proxied without exposing the upstream URL.

## Client contract

Web, Android, iOS and desktop clients call the normal ZiPo playback endpoint:

```text
POST /api/v2/playback/sessions
```

Clients never call the resolver or CDN directly and never contain resolver/CDN
credentials.

## Production controls

- Use different secrets for auth, playback sessions, resolver v1, and MegaFlix v2.
- Keep redirects disabled and enforce exact HTTPS origins on every manifest resource.
- ZiPo rejects non-public DNS answers, but a network egress firewall must also block
  loopback, private, link-local, metadata and internal service ranges.
- Rotate signed upstream URLs with short expirations. Never put provider cookies,
  browser automation, DRM keys, or arbitrary headers in the resolver response.

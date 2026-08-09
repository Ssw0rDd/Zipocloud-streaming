# Modelo de ameaças do ZiPo

Revisão: 2026-08-08. Escopo: browser, web, API, workers, Stream Bridge, edge,
PostgreSQL, Redis, storage e integrações declaradas no repositório.

## Ativos

1. sessões, hashes de senha, perfis e histórico;
2. secrets de auth, OAuth, pagamento, storage e mídia;
3. entitlement de apoiador e integridade financeira;
4. mídia própria/licenciada, tokens temporários e chaves de sessão;
5. isolamento de conteúdo adulto e dados entre usuários;
6. disponibilidade de API, filas, FFmpeg, cache, banco e storage.

## Adversários

- visitante, bot e usuário autenticado malicioso;
- site externo tentando CSRF, clickjacking ou exfiltração;
- provider/CDN comprometido retornando URL, redirect, manifesto ou mídia hostil;
- processo comprometido tentando movimento lateral na rede interna;
- pessoa com leitura parcial de logs, banco, Redis ou artefatos estáticos;
- consumidor legítimo controlando o próprio browser/dispositivo.

## Fronteiras e controles

| Fronteira | Entrada | Controles |
|---|---|---|
| Internet → Nginx | HTTP, TLS, headers, corpo | TLS 1.2/1.3, redirect, limites, logs redigidos |
| Browser → web/API | URL, cookie, JSON, WS | CSP nonce, validação, authz, CSRF, CORS, rate limit |
| API → dados | identidade e conteúdo | sessão server-side, ownership, ORM, transações, TTL |
| API/worker → internet | metadados e mídia | HTTPS, allowlist, DNS público, redirect manual, timeout/bytes |
| Serviço → storage | objetos e signed URLs | bucket privado, credencial por serviço, URLs curtas |
| API → pagamento | ordem/webhook | valor server-side, idempotência, HMAC, replay window |
| Source → CI/release | dependências e artefatos | lock, pins, Action SHA, audits, build e gates |

## Cenários principais

### Identidade e autorização

- Credential stuffing: limite específico de auth e senha 15–128; MFA/e-mail
  permanecem risco residual.
- Fixação/roubo de sessão: cookie Better Auth seguro, TLS e logout server-side.
- IDOR: identidade vem de `session.user.id`; recursos próprios filtram ownership.
- CSRF/CORS: mutações com cookie exigem origem permitida; preflights estrangeiros
  não recebem credenciais.

### Browser

- XSS: escaping React, sanitização textual, ausência de HTML remoto e CSP com
  nonce/`strict-dynamic`; estilos inline são risco residual.
- Clickjacking: `frame-ancestors 'none'` e `X-Frame-Options: DENY`.
- Exposição de build: sem source maps/client source, scan por secrets/private key
  e nenhuma variável sensível `NEXT_PUBLIC_*`.
- Código cliente é observável. Controles de teclado/devtools e ofuscação não são
  fronteiras de segurança e não substituem autorização/DRM.

### SSRF e processamento de mídia

- URLs de cliente não chegam diretamente a fetch, Sharp ou FFmpeg.
- Resolvers validam protocolo, credenciais, porta, host, DNS e cada redirect.
- Manifests e respostas possuem limites; subprocessos têm timeout/retry/cleanup.
- Egress no ambiente continua necessário contra falhas de aplicação e DNS.

### Entrega protegida

- Token assinado vincula usuário, vídeo e expiração; Redis impede sequência
  paralela e aplica rate limit de init.
- P-256/ECDH entrega apenas uma chave embrulhada; HKDF separa domínios de chave.
- AES-256-GCM usa IV por segmento e AAD por sessão/vídeo/índice.
- Replays, adulteração e índice fora de ordem falham; o plaintext ainda existe em
  memória no player durante reprodução.

### Disponibilidade e cadeia de dependências

- filas, durações, tamanho de payload, records e workers são limitados;
- jobs interrompidos são persistidos/reconciliados e temporários são removidos;
- Redis é dependência distribuída e usa senha; falha não deve liberar acesso;
- pnpm frozen lock, pins Python, imagens versionadas, Actions por SHA, Dependabot
  e audits reduzem mudanças não revisadas.

## Invariantes

- nenhum segredo durável é entregue ao browser ou escrito em logs/queries;
- nenhuma autorização depende de header de identidade do cliente;
- nenhuma URL arbitrária chega a processadores ou rede de backend;
- nenhum pagamento concede benefício sem assinatura e idempotência;
- nenhum conteúdo adulto é autorizado apenas por flag do frontend;
- nenhum job pode crescer sem limite ou terminar sem estado/cleanup;
- nenhuma sessão protegida aceita segmento paralelo, repetido ou adulterado;
- nenhum teste ativo do repositório alcança host não local.

## Casos mínimos de abuso

- duas contas para IDOR em perfil, playlist, clip, pagamento e histórico;
- CSRF/CORS com origem ausente, permitida e estrangeira;
- XSS armazenado/refletido e CSP do HTML de produção;
- SSRF com loopback, RFC1918, link-local, IPv6, DNS misto e redirects;
- replay de webhook/idempotency key e alteração de valor;
- flood controlado de fila, timeout de provider e restart de worker/bridge;
- token expirado/adulterado, IV/AAD alterados e segmento fora de ordem;
- scan de logs, respostas, source maps e bundles por credenciais.

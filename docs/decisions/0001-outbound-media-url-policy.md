# ADR-001: Política de URLs de mídia de saída

## Status

Aceita

## Data

2026-08-08

## Contexto

A API, o media worker e o Stream Bridge processam manifests e mídia de serviços
externos. Providers podem responder com URLs assinadas, playlists aninhadas e
redirecionamentos. Aceitar esses valores sem uma política única permite SSRF,
acesso a metadata da nuvem, movimento lateral e entrega de protocolos perigosos
ao FFmpeg.

## Decisão

Toda URL externa que possa alcançar `fetch`, Sharp ou FFmpeg deve:

- usar HTTPS e, salvo exceção documentada, porta 443;
- não conter usuário/senha;
- corresponder a origem/host exato ou sufixo explicitamente configurado;
- resolver somente para IPs públicos, incluindo após normalização IPv4-mapped;
- ter cada redirect validado antes do próximo request;
- ter timeout, limite de redirects e limite de bytes;
- ser resolvida a partir de IDs validados ou resposta autenticada, nunca de uma
  URL arbitrária enviada pelo cliente;
- ser protegida também por uma política de egress no ambiente de execução.

Hosts descobertos dinamicamente não entram automaticamente na allowlist. A
exceção atual para o padrão de CDN Voltz exige HTTPS, path MP4 esperado, padrão
de hostname estrito e resolução pública antes do uso.

## Alternativas consideradas

### Bloquear apenas IPs privados depois de receber a URL

Rejeitada: não cobre redirects, DNS com resposta mista, IPv6, credenciais em URL
ou DNS rebinding.

### Permitir qualquer subdomínio do provider por padrão

Rejeitada: amplia muito o impacto de subdomain takeover e de conteúdo controlado
por terceiros. Sufixos precisam ser explícitos na configuração.

### Confiar somente no firewall

Rejeitada: egress é defesa indispensável, mas não oferece contexto de protocolo,
host, redirect e tamanho da resposta. As duas camadas são complementares.

### Proxy genérico de mídia

Rejeitada: transforma o serviço em relay abusável e dificulta autorização,
custos e conformidade.

## Consequências

- Novos CDNs exigem mudança explícita de configuração e teste.
- Alguns providers com hosts altamente dinâmicos podem não ser compatíveis.
- A aplicação realiza consultas DNS adicionais antes dos requests.
- O deploy precisa manter regras de egress coerentes com a allowlist.
- Testes devem cobrir loopback, redes privadas, link-local, IPv6, DNS misto,
  redirects e respostas grandes.


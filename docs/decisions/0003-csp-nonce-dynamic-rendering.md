# ADR-003: CSP com nonce e renderização dinâmica

## Status

Aceita

## Data

2026-08-08

## Contexto

A aplicação Next.js precisa executar scripts de hidratação sem permitir
`script-src 'unsafe-inline'`. O nonce precisa ser novo por resposta e estar
presente simultaneamente no header CSP e nas tags emitidas pelo framework.

## Decisão

O middleware gera um nonce por request, encaminha `x-nonce` ao Next.js e envia a
CSP correspondente. O layout localizado lê `headers()` e usa
`dynamic = "force-dynamic"`; `generateStaticParams` foi removido para impedir
HTML estático incompatível com um nonce por resposta. `strict-dynamic` e
`script-src-attr 'none'` restringem scripts. `style-src 'unsafe-inline'`
permanece temporariamente por compatibilidade com estilos do framework.

## Alternativas consideradas

### Hashes estáticos

Não escolhida para o App Router atual porque chunks e scripts gerados variam no
build e a manutenção de hashes seria frágil.

### CSP sem nonce e com scripts inline

Rejeitada: reduz materialmente a proteção contra uma eventual injeção HTML.

## Consequências

- Rotas localizadas são renderizadas por request e não podem ser servidas como
  HTML estático de CDN.
- Assets `_next/static` continuam imutáveis e cacheáveis.
- Performance deve ser acompanhada por TTFB/RUM; cache de dados e streaming SSR
  passam a ser mais importantes.
- Remover `style-src 'unsafe-inline'` exigirá migrar estilos inline restantes.

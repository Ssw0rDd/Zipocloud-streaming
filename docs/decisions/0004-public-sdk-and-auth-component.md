# ADR-004: SDK público autocontido e login por Custom Element

## Status

Aceita

## Data

2026-08-08

## Contexto

Integrações externas não podem depender dos módulos internos Elysia/Eden nem de
um pacote privado do monorepo. A UI de login deve funcionar em React, Vue,
Svelte, HTML ou outra stack sem duplicar design e regras de sessão.

## Decisão

- `@zipo/api-client` expõe uma classe Fetch com contratos públicos próprios,
  timeout, abort, cookies e erro estável;
- as declarações compiladas não importam `@zipo/shared` ou `@zipo/api`;
- `@zipo/auth-ui` expõe `<zipo-auth>` com Shadow DOM e depende somente do SDK;
- eventos compostos comunicam sucesso/erro, e redirects são same-origin;
- nenhum pacote persiste senha, token ou cookie em Web Storage;
- ESM, TypeScript declarations, MIT e metadata de Custom Elements compõem o
  formato de distribuição.

## Alternativas consideradas

### Eden Treaty como API pública

Rejeitada: acopla consumidores à árvore de tipos e ao framework interno, aumenta
tempo de compilação e torna mudanças de backend potencialmente breaking.

### Componente React

Rejeitado como única opção: limita adoção por outras stacks. A aplicação ZiPo
pode continuar usando componentes React próprios sobre os mesmos endpoints.

## Consequências

- Contratos públicos precisam de versionamento e testes de compatibilidade.
- Novas rotas não entram automaticamente no SDK; `request<T>` permite extensão
  conservadora até a próxima versão.
- Publicação no registry e proveniência de pacotes continuam sendo ações de
  release separadas.

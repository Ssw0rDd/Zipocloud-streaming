# Referência HTTP da ZiPo

Base pública recomendada: `https://zipo.example.com`. Rotas da aplicação usam
`/api/v1`, `/api/v2` ou `/api/v3`; autenticação usa `/api/auth`. O browser deve
preferir same-origin e enviar cookies com `credentials: "include"`.

## Convenções

- Tipos de conteúdo: `movie`, `series`, `anime`.
- JSON é o formato padrão; `204` não possui corpo.
- IDs e paginação são validados no servidor.
- Erros usam `{ "error": "mensagem", "code": "CODIGO_ESTAVEL" }`; detalhes
  internos e stack traces não são retornados.
- Mutações autenticadas por cookie exigem `Origin` ou `Referer` allowlisted.
- `Idempotency-Key` é obrigatório onde indicado e deve ser aleatório.
- Respostas podem trazer `X-Request-ID` para correlação sem expor secrets.

## Autenticação e conta

| Método | Rota | Autenticação | Finalidade |
|---|---|---:|---|
| POST | `/api/auth/sign-up/email` | não | criar conta por e-mail/senha |
| POST | `/api/auth/sign-in/email` | não | iniciar sessão |
| GET | `/api/auth/get-session` | opcional | ler sessão atual |
| POST | `/api/auth/sign-out` | sim | encerrar sessão |
| GET | `/api/v1/account/me` | sim | ler conta e confirmação adulta |
| POST | `/api/v1/account/confirm-adult` | sim | confirmar maioridade |

Senhas aceitam de 15 a 128 caracteres. Em produção, cookies são `Secure` e o
edge redireciona HTTP para HTTPS.

## Catálogo e descoberta

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/v1/catalog/:type` | catálogo paginado |
| GET | `/api/v1/search?q=` | busca unificada |
| GET | `/api/v1/search/suggestions?q=` | sugestões curtas |
| GET | `/api/v1/content/:type/:id` | metadados do conteúdo |
| GET | `/api/v1/content/:type/:id/enriched` | detalhe agregado |
| GET | `/api/v1/content/:type/:id/episodes` | episódios |
| GET | `/api/v1/content/:type/:id/trailer` | trailer |
| GET | `/api/v1/featured` | destaques |
| GET | `/api/v2/aggregate/:type/:id` | manifesto agregado para a UI |
| GET | `/api/v3/home` | home cacheável com metadados de freshness |

Filtros comuns incluem `locale`, `includeAdult`, `genres`, `skip` e `limit`.
Conteúdo adulto ainda depende das políticas de site, sessão e conta; o parâmetro
do cliente não concede autorização.

## Playback

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/v1/playback/providers` | providers habilitados |
| GET | `/api/v1/playback/discover/:type/:id` | fontes disponíveis |
| POST | `/api/v1/playback/resolve` | resolver provider selecionado |
| POST | `/api/v1/playback/sessions` | criar sessão opaca |
| POST | `/api/v1/playback/sessions/:id/select` | trocar servidor |
| POST | `/api/v1/playback/sessions/:id/refresh` | renovar sessão |
| POST | `/api/v2/playback/sessions` | bootstrap do player v2 |
| POST | `/api/v2/playback/embeds` | embeds seguros habilitados |
| GET | `/api/v2/playback/preparations/:id` | estado de preparação |

As respostas dependem de feature flags e disponibilidade. URLs nativas são
same-origin e opacas; embeds continuam sob os termos e controles do provedor.
O mapa operacional completo está em [STREAM_ENDPOINTS.md](STREAM_ENDPOINTS.md).

## Segmentos próprios/licenciados

Esse fluxo é opcional e exige sessão autenticada, Redis e
`PROTECTED_STREAM_ENABLED=true`.

| Método | Rota | Requisitos |
|---|---|---|
| GET | `/api/stream/init/:videoId` | cookie + `X-Client-Public-Key` P-256 |
| GET | `/api/stream/manifest/:videoId` | `Authorization: Bearer <sessionToken>` |
| GET | `/api/stream/segment/:videoId/:index` | bearer; índice estritamente sequencial |

`init` retorna token de 30 minutos, contagem, manifesto e material para unwrap da
chave efêmera. Segmentos usam AES-256-GCM, IV único em `X-Segment-IV` e AAD
vinculada a token, vídeo e índice. Isso protege transporte e reutilização casual;
não transforma código executado no browser em segredo nem substitui DRM.

## Recursos autenticados

| Método | Rota | Finalidade |
|---|---|---|
| GET/POST | `/api/v2/profiles` | listar/criar perfis |
| PATCH/DELETE | `/api/v2/profiles/:id` | editar/remover perfil próprio |
| GET | `/api/v2/history` | histórico |
| POST | `/api/v2/history/mark-watched` | marcar como visto |
| POST | `/api/v2/history/import` | importar com idempotência |
| GET/POST | `/api/v1/playlists` | listar/criar playlists |
| GET/PATCH/DELETE | `/api/v1/playlists/:id` | operar playlist própria |
| POST/DELETE | `/api/v1/playlists/:id/items` | operar itens |
| POST | `/api/v1/reactions` | like/dislike/remove |
| POST | `/api/v1/clips` | criar clip autorizado |
| POST | `/api/v1/clips/:token/retry` | repetir job próprio |

Autorização é sempre derivada da sessão; headers de identidade enviados pelo
cliente não são autoridade.

## Comentários, Cinema, telemetria e apoio

| Método | Rota | Finalidade |
|---|---|---|
| GET/POST | `/api/v1/anime/:id/comments` | listar/criar comentário |
| GET/POST | `/api/v1/series/:id/comments` | listar/criar comentário |
| PATCH | `/api/v1/:type/:id/comments/:commentId` | editar comentário próprio |
| DELETE | `/api/v1/comments/:id` | excluir comentário próprio |
| POST | `/api/v1/cinema/rooms` | criar sala |
| POST | `/api/v1/cinema/rooms/:token/join` | entrar em sala |
| GET | `/api/v1/cinema/rooms/:token/messages` | mensagens |
| POST | `/api/v1/views` | registrar progresso/visualização |
| POST | `/api/v1/rum` | métricas web allowlisted |
| GET | `/api/v1/donate/config` | configuração Pix pública |
| POST | `/api/v1/donate/pix` | criar ordem Pix autenticada/idempotente |
| GET | `/api/v1/donate/orders/:id` | consultar ordem própria |

O webhook Mercado Pago é server-to-server, autenticado por assinatura e não é
um endpoint de integração do frontend. Veja [SUPPORTER_PIX.md](SUPPORTER_PIX.md).

## Saúde

| Rota | Semântica |
|---|---|
| `/health/live` | processo está vivo |
| `/health/ready` | PostgreSQL e Redis disponíveis |
| `/health` | estado agregado e telemetria de providers |

O orquestrador deve usar `/health/ready`; falha de provider externo não remove a
API do balanceador.

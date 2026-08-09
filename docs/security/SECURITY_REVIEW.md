# Revisão de segurança

Data: 2026-08-08. Escopo: código e configuração deste repositório. “Corrigido”
significa mudança coberta por teste/gate local; não equivale a certificação,
auditoria jurídica de conteúdo ou pentest externo.

## Resultado

Nenhuma falha crítica ou alta confirmada permanece aberta na arquitetura
inspecionada. O caminho de produção agora inclui TLS, Redis autenticado,
containers não-root/read-only, CSP com nonce, tokens armazenados com criptografia
autenticada, jobs limitados/persistidos e gates de cadeia de dependências e
artefatos.

| Severidade aberta | Quantidade | Situação |
|---|---:|---|
| Crítica | 0 | nenhuma confirmada |
| Alta | 0 | nenhuma confirmada |
| Moderada | 3 | identidade avançada, provider iframe, cobertura staging |
| Leve | 4 | hashes Python, digests, style CSP, TLS interno |

## Achados corrigidos

| ID | Sev. | Achado | Controle implementado |
|---|---|---|---|
| SEC-001 | Alta | URLs externas e redirects podiam alcançar processamento sem política uniforme | HTTPS/allowlist/DNS público/redirect manual/timeouts/limites antes de fetch e FFmpeg |
| SEC-002 | Alta | Mutações por cookie sem evidência de origem | CSRF por Origin/Referer/Sec-Fetch-Site e CORS exato |
| SEC-003 | Alta | Headers de proxy podiam selecionar chaves de rate limit | trust explícito e edge sobrescrevendo IP encaminhado |
| SEC-004 | Alta | Tokens temporários podiam entrar em access logs | rotas tokenizadas excluídas do log e log format sem query |
| SEC-005 | Alta | Containers com privilégios padrão | usuário não-root, read-only, `cap_drop: ALL`, no-new-privileges, PID/tmpfs |
| SEC-006 | Alta | Produção podia ser iniciada apenas em HTTP | Nginx TLS 1.2/1.3, portas 80/443, redirect 308 e HSTS |
| SEC-007 | Alta | Token OAuth AniList em texto puro | AES-256-GCM com AAD, chave independente e migração no startup |
| SEC-008 | Moderada | `script-src 'unsafe-inline'` | nonce por request, `strict-dynamic`, layout dinâmico e teste do build |
| SEC-009 | Moderada | Redis interno sem autenticação | senha forte obrigatória no compose e validação de URL em produção |
| SEC-010 | Moderada | Jobs do Stream Bridge ilimitados e apenas em memória | SQLite, reconciliação, fila/workers/records limitados e TTL |
| SEC-011 | Moderada | Dependências/actions/images flutuantes | versões diretas fixas, Actions por SHA, Dependabot e gate estático |
| SEC-012 | Moderada | SDK público dependia de contratos privados | tipos autocontidos, build ESM/d.ts e testes de distribuição |
| SEC-013 | Moderada | Segmentos não possuíam envelope autenticado por sessão | HKDF, AES-256-GCM, AAD por vídeo/índice, unwrap P-256 e sequência Redis |
| SEC-014 | Leve | Artefatos do browser não tinham gate de exposição | auditoria pós-build de maps, fontes, private keys e valores de secrets |
| SEC-015 | Leve | Harness de segurança não tinha isolamento operacional | pasta dedicada e runner ativo limitado a loopback |
| SEC-016 | Moderada | Renovação do líder Redis podia rejeitar sem tratamento e encerrar a API | falhas são contidas, liderança é revogada e E2E sem Redis cobre a janela de renovação |

## Riscos residuais confirmados

| ID | Sev. | Risco | Tratamento |
|---|---|---|---|
| SEC-R01 | Moderada | Sem MFA, verificação de e-mail e recuperação de conta | selecionar provider transacional, adicionar fluxo Better Auth e exigir MFA para operações de maior impacto |
| SEC-R02 | Moderada | Embeds de terceiros sem sandbox completo podem executar código do provider | manter opt-in, CSP/frame allowlist, feature flag e preferir mídia própria/licenciada |
| SEC-R03 | Moderada | CI não substitui teste IDOR/CSRF/payment/playback em staging com configuração real | gate de release com duas contas, TLS real, storage privado e callbacks reais de teste |
| SEC-R04 | Leve | Python possui pins diretos, sem lock transitivo com hashes | gerar lock em ambiente Python controlado e revisar no Dependabot |
| SEC-R05 | Leve | Imagens estão por versão, não digest | registrar digest no release e promover a mesma imagem entre ambientes |
| SEC-R06 | Leve | `style-src 'unsafe-inline'` permanece | migrar estilos inline/framework e adotar nonce/hash também para style |
| SEC-R07 | Leve | Tráfego interno do compose de host único não usa TLS | manter rede/host confiável; usar mTLS/service mesh em cluster multi-host |

## Criptografia e limite de proteção

- TLS protege o trânsito público; AES-GCM protege tokens armazenados e segmentos
  opcionais; HMAC protege tokens e webhooks; Argon2id protege senhas de sala.
- Master secrets são independentes, server-only e validados por tamanho.
- O player precisa de chave e plaintext em memória para reproduzir. Portanto a
  entrega protegida reduz reutilização, paralelismo e exposição passiva, mas não
  torna cópia impossível para quem controla o browser e não substitui DRM.
- “Criptografia de criptomoeda” não é um primitive adequado. São usados HKDF,
  AES-256-GCM, HMAC-SHA-256 e ECDH P-256 com finalidades separadas.

## Evidências automatizadas

```bash
pnpm test:security
pnpm --filter @zipo/api test
pnpm test:sdk
pnpm pentest:static
pnpm check:supply-chain
pnpm build
pnpm check:artifacts
pnpm audit --audit-level=high
```

A CI também executa Python/pytest/pip-check, i18n, budgets de bundle e Playwright.
Docker e Python não estavam disponíveis na estação Windows desta revisão; esses
dois runtimes precisam ser confirmados pela CI Linux antes do release.

Baseline local final: 165/165 testes da API, 5/5 testes dos pacotes públicos,
2/2 controles estáticos de pentest, 14/14 probes ativos em loopback, 12/12 E2E
principais (4 NSFW condicionais ignorados) e 4/4 E2E NSFW na execução dedicada.
Build, lint, typecheck, 272 chaves em 9 locales, budgets, audit de dependências e
audit de quatro raízes de artefatos passaram.

## Gate bloqueante de produção

1. certificados válidos, redirect e cookies `Secure` verificados no domínio;
2. nenhum valor de exemplo e secrets independentes no secret manager;
3. CI completa verde, inclusive Python, browser e auditoria pós-build;
4. banco/Redis/MinIO sem portas públicas e restore de backup testado;
5. providers e mídia autorizados, com egress coerente com allowlists;
6. IDOR com duas contas, webhook replay e protected stream sequencial no staging;
7. revisão dos riscos residuais aceita pelo responsável do release.

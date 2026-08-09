# Deploy de produção

Este é o caminho suportado pelo `docker-compose.prod.yml`. O edge termina TLS,
redireciona HTTP para HTTPS e é o único serviço publicado no host.

Configuração local e variáveis: [SETUP.md](./SETUP.md), [CONFIGURATION.md](./CONFIGURATION.md).
Chaves de terceiros: [THIRD_PARTY_APIS.md](./THIRD_PARTY_APIS.md).

## 1. Pré-condições

- host Linux com Docker Engine e Compose atualizados;
- DNS apontando para o host;
- portas 80/443 liberadas;
- certificado válido com `fullchain.pem` e `privkey.pem`;
- backup externo e restaurável de PostgreSQL e MinIO;
- mídia e providers autorizados para o ambiente.

## 2. Ambiente

```bash
cp .env.example .env
mkdir -p secrets/tls
```

Configure pelo menos:

```dotenv
NODE_ENV=production
FRONTEND_URL=https://zipo.example.com
API_URL=https://zipo.example.com
BETTER_AUTH_URL=https://zipo.example.com
CORS_ORIGINS=https://zipo.example.com
POSTGRES_PASSWORD=[POSTGRES_PASSWORD]
REDIS_PASSWORD=[BASE64URL_32_PLUS]
BETTER_AUTH_SECRET=[RANDOM_32_PLUS]
PLAYBACK_SESSION_SECRET=[INDEPENDENT_RANDOM_32_PLUS]
CINEMA_ACCESS_SECRET=[INDEPENDENT_RANDOM_32_PLUS]
S3_ACCESS_KEY_ID=[S3_ACCESS_KEY]
S3_SECRET_ACCESS_KEY=[S3_SECRET_KEY]
TLS_CERT_DIR=./secrets/tls
```

Gere cada secret de forma independente. `REDIS_PASSWORD` deve ser base64url para
ser seguro tanto no comando do Redis quanto na URI `REDIS_URL`. Não mantenha
valores `change-me`.

Copie os certificados e permita leitura do private key somente ao UID/GID 101 do
container Nginx:

```bash
sudo install -o 101 -g 101 -m 0444 /path/fullchain.pem secrets/tls/fullchain.pem
sudo install -o 101 -g 101 -m 0400 /path/privkey.pem secrets/tls/privkey.pem
```

## 3. Validação e inicialização

```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
curl --fail https://zipo.example.com/health/ready
```

O container da API aplica migrations antes de abrir a porta. Se a migration
falhar, ele não fica ready. O healthcheck usa `/health/ready`, sem consultar
providers externos.

## 4. Serviços opcionais

```bash
docker compose -f docker-compose.prod.yml --profile media-worker up -d media-worker
docker compose -f docker-compose.prod.yml --profile stream-bridge up -d stream-bridge
```

Ative `CLIPS_ENABLED` ou `MEDIA_PREPARATION_ENABLED` apenas com worker saudável.
O Stream Bridge persiste estado SQLite no volume `zipo_stream_bridge_jobs`,
limita fila/records/workers e marca jobs interrompidos como falhos no startup.

`PROTECTED_STREAM_ENABLED` exige um volume somente leitura em
`PROTECTED_STREAM_ROOT_HOST`, `PROTECTED_STREAM_MASTER_SECRET` independente e
Redis disponível. A estrutura de cada vídeo é documentada em
[STREAM_ENDPOINTS.md](STREAM_ENDPOINTS.md).

## 5. Verificação de segurança

```bash
curl -I http://zipo.example.com/
curl -I https://zipo.example.com/
openssl s_client -connect zipo.example.com:443 -servername zipo.example.com </dev/null
docker compose -f docker-compose.prod.yml exec redis redis-cli --no-auth-warning \
  -a "$REDIS_PASSWORD" ping
```

Confirme redirect `308`, HSTS, `X-Content-Type-Options`, CSP sem
`script-src 'unsafe-inline'`, cookies `Secure`, bucket sem acesso anônimo e
ausência de portas de banco/cache/storage publicadas.

Rode o harness apenas contra uma instância local descartável:

```bash
pnpm pentest:local -- --base-url http://127.0.0.1:3001
```

## 6. Atualização e rollback

1. faça backup e teste restauração;
2. execute a CI completa no commit candidato;
3. construa imagens imutáveis e registre seus digests no release;
4. aplique migrations compatíveis para frente e para trás;
5. atualize API/worker, depois web/edge;
6. valide readiness, login, autorização, pagamento e playback autorizado;
7. em falha, reverta imagens e feature flags sem reverter dados às cegas.

Dependências diretas Python e tags de containers estão fixadas; o lock pnpm é
obrigatório e GitHub Actions usa SHA. `pnpm check:supply-chain` bloqueia
regressões básicas, enquanto Dependabot propõe atualizações revisáveis.

## 7. Limitações operacionais

- O compose não substitui firewall, política de egress, secret manager, rotação,
  observabilidade, backup e recuperação de desastre.
- TLS interno entre containers não está habilitado no compose de host único; em
  cluster ou rede não confiável, use mTLS/service mesh ou serviços gerenciados.
- Imagens estão fixadas por versão, não por digest; registre digests no processo
  de release para reprodutibilidade máxima.
- Verificação de e-mail, recuperação de conta e MFA dependem da escolha e
  configuração de um provedor transacional externo.

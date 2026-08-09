# Apoiador via Pix (Mercado Pago)

Fluxo server-side baseado na Orders API. O navegador não escolhe valor, não recebe access token e
não concede benefício. O status confiável vem de uma nova consulta à ordem no Mercado Pago após um
webhook com assinatura válida.

## Configuração

```env
MERCADO_PAGO_ENABLED=true
MERCADO_PAGO_ACCESS_TOKEN=<access-token-da-aplicacao>
MERCADO_PAGO_WEBHOOK_SECRET=<assinatura-secreta-do-webhook>
SUPPORTER_PIX_AMOUNT_CENTS=1000
SUPPORTER_PIX_EXPIRATION_MINUTES=30
```

`SUPPORTER_PIX_AMOUNT_CENTS` é inteiro em centavos e obrigatório quando habilitado. Configure no
painel do Mercado Pago a URL pública:

```text
https://SEU_DOMINIO/api/v1/donate/webhooks/mercado-pago
```

Referências oficiais: [integração Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix),
[Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks) e
[criar ordem](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/create-order/post).

## Segurança e consistência

- POST de criação exige login, `Idempotency-Key`, limite por IP e valor fixo do servidor.
- Requisição ao provider usa Pix/bank transfer, timeout, resposta limitada e retry idempotente.
- Webhook exige `x-signature`, `x-request-id`, `data.id` e janela anti-replay de 5 minutos.
- Corpo do webhook não libera acesso. A API consulta `GET /v1/orders/{id}` e confere referência,
  valor, BRL, método Pix e estado acreditado.
- Evento, ordem, entitlement e `users.is_supporter` são atualizados em transação. Reembolso,
  chargeback ou cancelamento revoga apenas o entitlement correspondente e reconcilia os restantes.

## Ativação

```powershell
pnpm dev:deps
pnpm db:migrate
pnpm --filter @zipo/api test:security
pnpm dev:all
```

Teste primeiro com credenciais/ambiente de teste. O fluxo real não é validável sem credenciais e
um webhook HTTPS público.

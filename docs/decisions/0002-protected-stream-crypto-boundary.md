# ADR-002: Fronteira criptográfica da entrega protegida

## Status

Aceita

## Data

2026-08-08

## Contexto

Mídia própria/licenciada precisa de sessões curtas, limitação de concorrência e
integridade por segmento. Uma chave enviada diretamente ao browser em storage
persistente ampliaria exposição e permitiria reutilização fora da sessão.

## Decisão

- `init` exige usuário autenticado e chave pública P-256 efêmera do browser;
- o token é assinado, vinculado a usuário/vídeo e expira em 30 minutos;
- Redis mantém próximo índice e aplica consumo estritamente sequencial;
- a chave de segmento deriva de HKDF-SHA-256 com master secret e token;
- cada segmento usa AES-256-GCM, IV de 96 bits e AAD com token, vídeo e índice;
- a chave derivada é embrulhada com segredo ECDH efêmero e AES-GCM;
- o cliente mantém chaves somente em memória e descarta o estado ao encerrar;
- TLS continua obrigatório e master secrets nunca saem do servidor.

## Alternativas consideradas

### Chave estática no JavaScript

Rejeitada: qualquer cliente receberia uma credencial reutilizável e global.

### Apenas URL assinada

Rejeitada como controle único: não fornece integridade autenticada por segmento
nem limita sequência; ainda é útil para outros recursos temporários.

### DRM comercial

Não implementado: exige empacotamento, licença, CDM e contratos próprios. Deve
ser escolhido separadamente quando o modelo de ameaça justificar.

## Consequências

- Requests paralelos e seeks arbitrários são incompatíveis com este modo.
- O player precisa de WebCrypto P-256, HKDF e AES-GCM.
- O browser necessariamente acessa plaintext durante reprodução; portanto o
  desenho aumenta custo e rastreabilidade, mas não promete impossibilidade de
  cópia nem “criptografia ponta a ponta” contra o usuário final.
- Redis é dependência de segurança e disponibilidade para a sequência.

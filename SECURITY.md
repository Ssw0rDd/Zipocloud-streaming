# Política de segurança

Onboarding Seguro: use apenas [`.env.example`](.env.example), leia [docs/SETUP.md](docs/SETUP.md) e **nunca** publique tokens em issues. Integrações de terceiros: [docs/THIRD_PARTY_APIS.md](docs/THIRD_PARTY_APIS.md).

## Versões suportadas

Enquanto o projeto estiver em `0.x`, somente a versão mais recente da branch
principal recebe correções de segurança.

## Reporte privado

Não publique vulnerabilidades, secrets, tokens, dados pessoais ou URLs de mídia
temporárias em issue pública. Use o canal privado de segurança configurado no
repositório ou envie a descrição para `[SECURITY_CONTACT]` com impacto, versão,
pré-condições e uma reprodução mínima sem dados de terceiros.

Espere confirmação em até 3 dias úteis e triagem inicial em até 7 dias úteis.
Não execute testes contra instalações que você não controla ou para as quais não
possui autorização explícita.

## Escopo

Estão em escopo: autenticação/autorização, isolamento de usuários, pagamentos,
SSRF, XSS/CSRF/CORS, exposição de secrets, entrega protegida de mídia própria,
storage e configuração de produção. Disponibilidade de APIs externas e conteúdo
ou infraestrutura de terceiros não estão em escopo.

O harness em `security/pentest` se recusa a testar hosts não locais e deve ser
usado apenas em instâncias descartáveis com dados sintéticos.

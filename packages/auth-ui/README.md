# @zipo/auth-ui

Web Component de autenticação acessível, sem framework e sem armazenamento de
credenciais no navegador.

```html
<script type="module">
  import "@zipo/auth-ui";
</script>

<zipo-auth
  api-base="https://zipo.example.com"
  locale="pt"
  redirect-url="/pt/profile"
></zipo-auth>
```

Eventos públicos: `zipo-auth-success` e `zipo-auth-error`. O redirect é aceito
somente quando permanece na mesma origem.

# Integração com projetos em diferentes linguagens

A API usa HTTP/JSON e cookies de sessão. Os exemplos públicos abaixo consultam
busca sem autenticação; substitua `[API_BASE_URL]` por uma origem HTTPS sem barra
final. Para sessões, use um cookie jar persistente apenas em memória ou no secret
store apropriado ao runtime.

## TypeScript, JavaScript, Bun e Node.js

```ts
import { createApiClient } from "@zipo/api-client";

const zipo = createApiClient("[API_BASE_URL]");
const result = await zipo.search("Duna", { type: "movie", limit: 10 });
console.log(result.items);
```

Sem SDK:

```js
const response = await fetch(
  "[API_BASE_URL]/api/v1/search?q=Duna&type=movie&limit=10",
  { headers: { Accept: "application/json" } },
);
if (!response.ok) throw new Error(`ZiPo HTTP ${response.status}`);
console.log(await response.json());
```

## Python

```python
import requests

with requests.Session() as session:
    response = session.get(
        "[API_BASE_URL]/api/v1/search",
        params={"q": "Duna", "type": "movie", "limit": 10},
        headers={"Accept": "application/json"},
        timeout=15,
    )
    response.raise_for_status()
    print(response.json()["items"])
```

## Go

```go
package main

import (
  "encoding/json"
  "fmt"
  "net/http"
  "net/url"
  "time"
)

func main() {
  endpoint, _ := url.Parse("[API_BASE_URL]/api/v1/search")
  query := endpoint.Query()
  query.Set("q", "Duna")
  query.Set("type", "movie")
  query.Set("limit", "10")
  endpoint.RawQuery = query.Encode()

  client := &http.Client{Timeout: 15 * time.Second}
  response, err := client.Get(endpoint.String())
  if err != nil { panic(err) }
  defer response.Body.Close()
  if response.StatusCode != http.StatusOK { panic(response.Status) }

  var result map[string]any
  if err := json.NewDecoder(response.Body).Decode(&result); err != nil { panic(err) }
  fmt.Println(result["items"])
}
```

## Java 21+

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

var client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .build();
var request = HttpRequest.newBuilder()
    .uri(URI.create("[API_BASE_URL]/api/v1/search?q=Duna&type=movie&limit=10"))
    .timeout(Duration.ofSeconds(15))
    .header("Accept", "application/json")
    .GET()
    .build();
var response = client.send(request, HttpResponse.BodyHandlers.ofString());
if (response.statusCode() != 200) throw new IllegalStateException(response.body());
System.out.println(response.body());
```

## C# / .NET 8+

```csharp
using System.Net.Http.Json;

using var client = new HttpClient {
    BaseAddress = new Uri("[API_BASE_URL]"),
    Timeout = TimeSpan.FromSeconds(15),
};
var result = await client.GetFromJsonAsync<SearchResult>(
    "/api/v1/search?q=Duna&type=movie&limit=10");
Console.WriteLine(result?.Items.Count);

public sealed record SearchItem(string Id, string Type, string Title, bool IsAdult);
public sealed record SearchResult(IReadOnlyList<SearchItem> Items);
```

## cURL

```bash
curl --fail-with-body \
  --header 'Accept: application/json' \
  '[API_BASE_URL]/api/v1/search?q=Duna&type=movie&limit=10'
```

## Sessão e mutações

Em browser, use `credentials: "include"` e uma origem CORS exata. Em clientes de
servidor, preserve os cookies retornados por `/api/auth/sign-in/email`. Mutações
browser autenticadas precisam de `Origin`/`Referer`; integrações server-to-server
sem cookie não devem inventar identidade em headers.

```bash
curl --fail-with-body --cookie-jar .zipo-cookie-jar \
  --header 'Content-Type: application/json' \
  --data '{"email":"[EMAIL]","password":"[PASSWORD]"}' \
  '[API_BASE_URL]/api/auth/sign-in/email'

curl --fail-with-body --cookie .zipo-cookie-jar \
  '[API_BASE_URL]/api/v1/account/me'
```

Não registre o cookie jar no repositório. Para operações idempotentes, gere uma
chave nova por intenção e repita a mesma chave somente ao repetir a mesma
operação.

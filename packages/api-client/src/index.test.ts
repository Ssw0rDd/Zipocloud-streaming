import { describe, expect, test } from "bun:test";
import { ZipoApiError, createApiClient } from "./index";

describe("ZiPo public SDK", () => {
  test("serializes queries and sends cookie credentials", async () => {
    let observed: Request | undefined;
    const client = createApiClient({
      baseUrl: "https://zipo.example",
      fetch: async (input, init) => {
        observed = new Request(input, init);
        return Response.json({ items: [] });
      },
    });
    await client.search("red room", { type: "movie", page: 2 });
    expect(observed?.url).toBe("https://zipo.example/api/v1/search?q=red+room&type=movie&page=2");
    expect(observed?.credentials).toBe("include");
  });

  test("normalizes structured API failures", async () => {
    const client = createApiClient({
      fetch: async () => Response.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401, headers: { "x-request-id": "req-1" } },
      ),
    });
    const error = await client.account().catch((value) => value);
    expect(error).toBeInstanceOf(ZipoApiError);
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.requestId).toBe("req-1");
  });

  test("aborts requests at the configured deadline", async () => {
    const client = createApiClient({
      timeoutMs: 5,
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    });
    const error = await client.health().catch((value) => value);
    expect(error).toBeInstanceOf(ZipoApiError);
    expect(error.code).toBe("NETWORK_ERROR");
  });
});

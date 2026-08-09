import { describe, expect, test } from "bun:test";
import { resolveClientIp } from "../../src/lib/client-ip";

describe("trusted proxy client IP resolution", () => {
  test("ignores spoofable forwarding headers when proxy trust is disabled", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: {
        "X-Forwarded-For": "198.51.100.40",
        "X-Real-IP": "198.51.100.41",
      },
    });

    expect(resolveClientIp(request, "203.0.113.10", false)).toBe("203.0.113.10");
  });

  test("uses the proxy-supplied address only when proxy trust is enabled", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { "X-Forwarded-For": "198.51.100.40" },
    });

    expect(resolveClientIp(request, "172.20.0.5", true)).toBe("198.51.100.40");
  });

  test("rejects malformed proxy values instead of creating attacker-selected keys", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { "X-Forwarded-For": "attacker-controlled-value" },
    });

    expect(resolveClientIp(request, "172.20.0.5", true)).toBe("172.20.0.5");
  });
});

import { describe, expect, it } from "bun:test";
import { isSealedSecret, openSecret, sealSecret } from "../../src/lib/token-vault";

const KEY = "test-only-independent-oauth-key-with-32-characters";

describe("authenticated token vault", () => {
  it("encrypts nondeterministically and binds ciphertext to its context", () => {
    const first = sealSecret("oauth-access-token", KEY, "anilist:user-1:access");
    const second = sealSecret("oauth-access-token", KEY, "anilist:user-1:access");
    expect(first).not.toBe(second);
    expect(isSealedSecret(first)).toBe(true);
    expect(openSecret(first, KEY, "anilist:user-1:access")).toBe("oauth-access-token");
    expect(() => openSecret(first, KEY, "anilist:user-2:access")).toThrow();
  });

  it("rejects ciphertext and authentication-tag tampering", () => {
    const sealed = sealSecret("oauth-refresh-token", KEY, "anilist:user-1:refresh");
    const parts = sealed.split(":");
    const tag = Buffer.from(parts[4]!, "base64url");
    tag[0] ^= 1;
    parts[4] = tag.toString("base64url");
    expect(() => openSecret(parts.join(":"), KEY, "anilist:user-1:refresh")).toThrow();
  });
});

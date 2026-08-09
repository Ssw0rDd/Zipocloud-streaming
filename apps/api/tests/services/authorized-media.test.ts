import { describe, expect, test } from "bun:test";
import {
  rewriteAuthorizedHlsManifest,
  signAuthorizedResolverPayload,
  validateAuthorizedMediaUrl,
  verifyAuthorizedResolverResponse,
} from "../../src/services/authorized-media";
import { isPublicIpAddress } from "../../src/lib/ssrf";

const origins = ["https://media.example.com", "https://cdn.example.com"];
const token = "Abcdefghijklmnopqrstuvwx";
const secret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

describe("authorized media security", () => {
  test("rejects private, link-local, documentation and mapped IP ranges", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.2", "192.168.1.2", "198.51.100.5", "203.0.113.5", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
      expect(isPublicIpAddress(address)).toBe(false);
    }
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  test("accepts only exact HTTPS origins", () => {
    expect(
      validateAuthorizedMediaUrl(
        "https://media.example.com/title/master.m3u8?token=abc",
        origins,
      )?.hostname,
    ).toBe("media.example.com");
    for (const unsafe of [
      "http://media.example.com/title/master.m3u8",
      "https://media.example.com.evil.test/title/master.m3u8",
      "https://user:pass@media.example.com/title/master.m3u8",
      "https://evil.test/title/master.m3u8",
      "https://127.0.0.1/title/master.m3u8",
    ]) {
      expect(validateAuthorizedMediaUrl(unsafe, origins)).toBeNull();
    }
  });

  test("binds resolver responses to timestamp, nonce and exact body", () => {
    const timestamp = "1999999999999";
    const nonce = "abcdefghijklmnopqrstuvwx";
    const body = '{"sources":[]}';
    const signature = signAuthorizedResolverPayload(
      "response",
      timestamp,
      nonce,
      body,
      secret,
    );
    expect(
      verifyAuthorizedResolverResponse(
        timestamp,
        nonce,
        body,
        signature,
        secret,
      ),
    ).toBe(true);
    expect(
      verifyAuthorizedResolverResponse(
        timestamp,
        nonce,
        '{"sources":[{}]}',
        signature,
        secret,
      ),
    ).toBe(false);
    expect(
      verifyAuthorizedResolverResponse(
        timestamp,
        nonce + "x",
        body,
        signature,
        secret,
      ),
    ).toBe(false);
  });

  test("rewrites playlists to encrypted same-origin resource paths", () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"',
      "variant/index.m3u8",
      "segment-001.ts?token=abc",
    ].join("\n");
    const rewritten = rewriteAuthorizedHlsManifest(
      manifest,
      "https://media.example.com/title/master.m3u8",
      token,
      origins,
      secret,
    );
    expect(rewritten).toContain(
      "/api/v1/playback/media/authorized/" + token + "/r/",
    );
    expect(rewritten).not.toContain("media.example.com");
    expect(rewritten).not.toContain("cdn.example.com");
    expect(rewritten).not.toContain("segment-001.ts");
  });

  test("rejects a playlist that escapes the configured origins", () => {
    expect(() =>
      rewriteAuthorizedHlsManifest(
        "#EXTM3U\nhttps://evil.test/segment.ts",
        "https://media.example.com/title/master.m3u8",
        token,
        origins,
        secret,
      ),
    ).toThrow("unsafe resource");
  });
});

import { describe, expect, test } from "bun:test";
import {
  detectImageMime,
  isAllowedImageHost,
  registerImageAsset,
} from "../../src/services/image-assets";

describe("image-assets SSRF / host allowlist", () => {
  test("rejects private IP and unsafe hosts", () => {
    expect(isAllowedImageHost("https://127.0.0.1/poster.jpg")).toBe(false);
    expect(isAllowedImageHost("https://10.0.0.1/poster.jpg")).toBe(false);
    expect(isAllowedImageHost("https://192.168.1.10/x.png")).toBe(false);
    expect(isAllowedImageHost("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedImageHost("http://image.tmdb.org/t/p/w500/a.jpg")).toBe(false);
    expect(isAllowedImageHost("https://evil.example.com/a.jpg")).toBe(false);
    expect(isAllowedImageHost("https://image.tmdb.org.evil.test/a.jpg")).toBe(false);
  });

  test("accepts allowlisted image hosts", () => {
    expect(isAllowedImageHost("https://image.tmdb.org/t/p/w500/abc.jpg")).toBe(true);
    expect(isAllowedImageHost("https://images.metahub.space/poster/medium/tt123.jpg")).toBe(true);
    expect(isAllowedImageHost("https://live.metahub.space/background/medium/tt123/img")).toBe(true);
    expect(isAllowedImageHost("https://cdn.myanimelist.net/images/anime/1.jpg")).toBe(true);
    expect(isAllowedImageHost("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg")).toBe(
      true,
    );
    expect(isAllowedImageHost("https://s1.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg")).toBe(
      true,
    );
    expect(isAllowedImageHost("https://media.kitsu.io/anime/poster_image/1.jpg")).toBe(true);
  });

  test("rejects untrusted third-party CDNs (e.g. Crunchyroll)", () => {
    expect(
      isAllowedImageHost(
        "https://img1.ak.crunchyroll.com/i/spire1-tmb/0a540e01e5d00a998a241d1ea23181ad1695991424_full.jpg",
      ),
    ).toBe(false);
  });
});

describe("image-assets MIME detection", () => {
  test("detects jpeg/png/webp/gif magic bytes", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    const junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    expect(detectImageMime(jpeg)).toBe("jpeg");
    expect(detectImageMime(png)).toBe("png");
    expect(detectImageMime(gif)).toBe("gif");
    expect(detectImageMime(webp)).toBe("webp");
    expect(detectImageMime(junk)).toBeNull();
    expect(detectImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("image-assets register", () => {
  test("registerImageAsset returns opaque same-origin MediaImage", async () => {
    const media = await registerImageAsset(
      "https://image.tmdb.org/t/p/w500/demo.jpg",
      "poster",
      "test",
    );
    expect(media).not.toBeNull();
    expect(media!.id.length).toBeGreaterThanOrEqual(8);
    expect(media!.url).toBe(`/api/v1/images/${media!.id}`);
    expect(media!.kind).toBe("poster");
    expect(media!.source).toBe("test");
  });

  test("registerImageAsset rejects bad hosts", async () => {
    const media = await registerImageAsset("https://127.0.0.1/x.jpg", "poster", "test");
    expect(media).toBeNull();
  });
});

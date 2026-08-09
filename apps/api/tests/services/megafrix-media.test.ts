import { describe, expect, test } from "bun:test";
import {
  rewriteHlsManifest,
  validateMegaFrixMediaUrl,
  validateMegaFrixResourceUrl,
} from "../../src/services/megafrix-media";

const hash = "6f2af23439be08c207d3bc696cdb115e";
const prefix = `/cdn/hls/${hash}/`;
const token = "Abcdefghijklmnopqrstuvwx";
const secret = "0123456789abcdefghijklmnopqrstuvwxyz";

describe("MegaFrix media proxy security", () => {
  test("allows only the exact upstream origin and session directory", () => {
    expect(
      validateMegaFrixMediaUrl(
        `https://embedplayer2.xyz${prefix}master.m3u8?expires=1999999999`,
      )?.hostname,
    ).toBe("embedplayer2.xyz");
    expect(
      validateMegaFrixMediaUrl(
        `https://evil.test${prefix}master.m3u8`,
      ),
    ).toBeNull();
    expect(
      validateMegaFrixResourceUrl(
        "https://plosia11.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
        prefix,
      )?.hostname,
    ).toBe("plosia11.xyz");
    expect(
      validateMegaFrixResourceUrl(
        "https://plosia99.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
        prefix,
      ),
    ).toBeNull();
    expect(
      validateMegaFrixResourceUrl(
        "https://dahds15.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.woff",
        prefix,
      )?.hostname,
    ).toBe("dahds15.xyz");
    expect(
      validateMegaFrixResourceUrl(
        "https://s2.dahds1.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.css",
        prefix,
      )?.hostname,
    ).toBe("s2.dahds1.xyz");
    expect(
      validateMegaFrixResourceUrl(
        "https://s2.dahds5.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.woff",
        prefix,
      )?.hostname,
    ).toBe("s2.dahds5.xyz");
    for (const unsafeUrl of [
      "https://dahds10.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://dahds16.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://dahds11.xyz.evil.test/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://dahds11.xyz:444/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://dahds11.xyz/p/short.js",
      "https://dahds11.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.exe",
      "https://dahds11.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js?next=https://evil.test",
      "https://s2.dahds0.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://s2.dahds6.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://s3.dahds1.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      "https://s2.dahds1.xyz.evil.test/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
    ]) {
      expect(validateMegaFrixResourceUrl(unsafeUrl, prefix)).toBeNull();
    }
    expect(
      validateMegaFrixMediaUrl(
        "https://embedplayer2.xyz/cdn/hls/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/segment.ts",
        prefix,
      ),
    ).toBeNull();
  });

  test("rewrites variants, segments and key URIs to opaque local paths", () => {
    const master = `https://embedplayer2.xyz${prefix}master.m3u8`;
    const rewritten = rewriteHlsManifest(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        "variant/index.m3u8",
        "segment-001.ts?token=abc",
      ].join("\n"),
      master,
      token,
      prefix,
      secret,
    );
    expect(rewritten).toContain(`/api/v1/playback/media/megafrix/${token}/r/`);
    expect(rewritten).not.toContain("embedplayer2.xyz");
    expect(rewritten).not.toContain('URI="key.bin"');

    const nested = rewriteHlsManifest(
      "#EXTM3U\nhttps://dahds11.xyz/p/IG0cjqIgoTyH3HLew2RsXSd1iAYHlYlTSeDjNCn2R40.js",
      `https://embedplayer2.xyz/hls/${hash}/index.m3u8`,
      token,
      prefix,
      secret,
    );
    expect(nested).toContain(`/api/v1/playback/media/megafrix/${token}/r/`);
    expect(nested).not.toContain("dahds11.xyz");
  });

  test("rejects an external URI embedded in a manifest", () => {
    expect(() =>
      rewriteHlsManifest(
        "#EXTM3U\nhttps://evil.test/segment.ts",
        `https://embedplayer2.xyz${prefix}master.m3u8`,
        token,
        prefix,
        secret,
      ),
    ).toThrow("unsafe resource");
  });
});

import { describe, expect, test } from "bun:test";
import { toSecureEmbed } from "../../src/playback/secure-embed";

describe("MegaFrix secure embeds", () => {
  test("accepts embedplayer2.xyz and vods.faz-o-eli.online iframe URLs", () => {
    const rola3 = toSecureEmbed({
      type: "iframe",
      url: "https://embedplayer2.xyz/rola3/6f2af23439be08c207d3bc696cdb115e",
      providerId: "megafrix",
      label: "MegaFrix Embed · Dublado",
      capabilities: {
        mode: "provider-iframe",
        requiresUnsandboxedFrame: true,
      },
    });
    expect(rola3?.url).toContain("embedplayer2.xyz/rola3/");
    expect(rola3?.sandbox).toBeNull();

    const voltz = toSecureEmbed({
      type: "iframe",
      url: "https://vods.faz-o-eli.online/voltz.php?type=episode&id=16173534",
      providerId: "megafrix",
      label: "MegaFrix Voltz · Dublado",
      capabilities: {
        mode: "provider-iframe",
        requiresUnsandboxedFrame: true,
      },
    });
    expect(voltz?.url).toContain("vods.faz-o-eli.online/voltz.php");
  });

  test("rejects foreign MegaFrix iframe hosts", () => {
    expect(
      toSecureEmbed({
        type: "iframe",
        url: "https://evil.test/rola3/6f2af23439be08c207d3bc696cdb115e",
        providerId: "megafrix",
        capabilities: {
          mode: "provider-iframe",
          requiresUnsandboxedFrame: true,
        },
      }),
    ).toBeNull();
  });
});

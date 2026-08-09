import { describe, expect, test } from "bun:test";
import { signAuthorizedResolverPayload } from "../../src/services/authorized-media";
import { validateMegaFlixGatewayResponse } from "../../src/services/megaflix-gateway";

const timestamp = "1999999999999";
const nonce = "abcdefghijklmnopqrstuvwx";
const secret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const origins = ["https://media.example.com"];

function signed(raw: string) {
  return signAuthorizedResolverPayload("response", timestamp, nonce, raw, secret);
}

describe("MegaFlix gateway v2 contract", () => {
  test("accepts signed native sources only from exact owned origins", () => {
    const raw = JSON.stringify({
      version: 2,
      sources: [
        { type: "hls", url: "https://media.example.com/movie/master.m3u8", label: "BR" },
        { type: "mp4", url: "https://media.example.com.evil.test/movie.mp4" },
      ],
    });
    expect(validateMegaFlixGatewayResponse({
      timestamp,
      nonce,
      raw,
      signature: signed(raw),
      secret,
      origins,
    })).toEqual([
      { type: "hls", url: "https://media.example.com/movie/master.m3u8", label: "BR" },
    ]);
  });

  test("fails closed on tampering, malformed JSON, and unknown fields", () => {
    const valid = JSON.stringify({ version: 2, sources: [] });
    expect(validateMegaFlixGatewayResponse({ timestamp, nonce, raw: valid + " ", signature: signed(valid), secret, origins })).toEqual([]);
    expect(validateMegaFlixGatewayResponse({ timestamp, nonce, raw: "{", signature: signed("{"), secret, origins })).toEqual([]);
    const extra = JSON.stringify({ version: 2, sources: [], unsafe: true });
    expect(validateMegaFlixGatewayResponse({ timestamp, nonce, raw: extra, signature: signed(extra), secret, origins })).toEqual([]);
  });
});

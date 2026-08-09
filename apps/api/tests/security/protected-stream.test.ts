import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createDecipheriv,
  createECDH,
  hkdfSync,
} from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { createProtectedStreamRoutes } from "../../src/routes/protected-stream";
import {
  decryptSegmentForTest,
  deriveSegmentKey,
  segmentAdditionalData,
} from "../../src/stream-protection/crypto";
import { MemoryProtectedStreamStore } from "../../src/stream-protection/store";
import {
  issueProtectedStreamToken,
  verifyProtectedStreamToken,
} from "../../src/stream-protection/token";

const MASTER_SECRET = "test-protected-stream-master-secret-000000000000";

describe("protected stream cryptography", () => {
  it("binds signed tokens to claims, expiry and tamper detection", () => {
    const issued = issueProtectedStreamToken({
      userId: "user-1",
      videoId: "movie-1",
      masterSecret: MASTER_SECRET,
      now: 1_000,
    });
    expect(verifyProtectedStreamToken(issued.token, MASTER_SECRET, 2_000)).toEqual(issued.claims);
    expect(verifyProtectedStreamToken(`${issued.token}x`, MASTER_SECRET, 2_000)).toBeNull();
    expect(verifyProtectedStreamToken(issued.token, MASTER_SECRET, issued.claims.expiresAt)).toBeNull();
  });
});

describe("protected stream routes", () => {
  let root = "";
  const segmentZero = Buffer.from("owned-video-segment-zero");
  const segmentOne = Buffer.from("owned-video-segment-one");
  const store = new MemoryProtectedStreamStore();
  const clientEcdh = createECDH("prime256v1");
  clientEcdh.generateKeys();

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zipo-protected-stream-test-"));
    const directory = join(root, "movie-1");
    await mkdir(directory);
    await writeFile(join(directory, "segment-000000.ts"), segmentZero);
    await writeFile(join(directory, "segment-000001.ts"), segmentOne);
    await writeFile(join(directory, "stream.json"), JSON.stringify({
      segmentDurationSeconds: 10,
      lastSegmentDurationSeconds: 8.5,
    }));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("wraps the session key and serves authenticated segments exactly in sequence", async () => {
    const app = new Elysia().use(createProtectedStreamRoutes({
      enabled: true,
      masterSecret: MASTER_SECRET,
      root,
      store,
      getUserId: async () => "user-1",
    }));
    const unauthorized = await app.handle(new Request(
      "http://localhost/api/stream/manifest/movie-1",
    ));
    expect(unauthorized.status).toBe(401);
    const init = await app.handle(new Request("http://localhost/api/stream/init/movie-1", {
      headers: { "X-Client-Public-Key": clientEcdh.getPublicKey().toString("base64url") },
    }));
    expect(init.status).toBe(200);
    const bootstrap = await init.json() as {
      sessionToken: string;
      manifestUrl: string;
      totalSegments: number;
      serverPublicKey: string;
      wrappedSessionKey: string;
      keyWrapIv: string;
    };
    expect(bootstrap.totalSegments).toBe(2);

    const shared = clientEcdh.computeSecret(Buffer.from(bootstrap.serverPublicKey, "base64url"));
    const wrappingKey = Buffer.from(hkdfSync(
      "sha256",
      shared,
      bootstrap.sessionToken,
      Buffer.from("zipo-segment-key-wrap-v1"),
      32,
    ));
    const wrapped = Buffer.from(bootstrap.wrappedSessionKey, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      wrappingKey,
      Buffer.from(bootstrap.keyWrapIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`zipo:key-wrap:v1\n${bootstrap.sessionToken}`));
    decipher.setAuthTag(wrapped.subarray(-16));
    const unwrapped = Buffer.concat([decipher.update(wrapped.subarray(0, -16)), decipher.final()]);
    expect(unwrapped.toString("hex")).toBe(
      deriveSegmentKey(MASTER_SECRET, bootstrap.sessionToken).toString("hex"),
    );

    const authorization = { Authorization: `Bearer ${bootstrap.sessionToken}` };
    const manifest = await app.handle(new Request(
      `http://localhost${bootstrap.manifestUrl}`,
      { headers: authorization },
    ));
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toContain("#EXT-X-TARGETDURATION:10");

    const outOfOrder = await app.handle(new Request(
      "http://localhost/api/stream/segment/movie-1/1",
      { headers: authorization },
    ));
    expect(outOfOrder.status).toBe(409);

    for (const [index, expected] of [segmentZero, segmentOne].entries()) {
      const response = await app.handle(new Request(
        `http://localhost/api/stream/segment/movie-1/${index}`,
        { headers: authorization },
      ));
      expect(response.status).toBe(200);
      const iv = response.headers.get("x-segment-iv")!;
      const decrypted = decryptSegmentForTest(
        new Uint8Array(await response.arrayBuffer()),
        iv,
        MASTER_SECRET,
        bootstrap.sessionToken,
        "movie-1",
        index,
      );
      expect(decrypted).toEqual(expected);
    }

    const replay = await app.handle(new Request(
      "http://localhost/api/stream/segment/movie-1/0",
      { headers: authorization },
    ));
    expect(replay.status).toBe(409);

    const aad = segmentAdditionalData(bootstrap.sessionToken, "movie-1", 0);
    expect(aad.toString()).toContain("movie-1");
  });
});

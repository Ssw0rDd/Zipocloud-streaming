import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const SEGMENT_INFO = Buffer.from("segment-key", "utf8");
const WRAP_INFO = Buffer.from("zipo-segment-key-wrap-v1", "utf8");
const P256_UNCOMPRESSED_BYTES = 65;

function hkdf(
  inputKey: string | Buffer,
  salt: string | Buffer,
  info: Buffer,
): Buffer {
  return Buffer.from(hkdfSync("sha256", inputKey, salt, info, 32));
}

export function deriveSegmentKey(masterSecret: string, sessionToken: string): Buffer {
  if (masterSecret.length < 32) throw new Error("Protected stream master secret is too short");
  return hkdf(masterSecret, sessionToken, SEGMENT_INFO);
}

export function segmentAdditionalData(
  sessionToken: string,
  videoId: string,
  segmentIndex: number,
): Buffer {
  return Buffer.from(`zipo:segment:v1\n${sessionToken}\n${videoId}\n${segmentIndex}`, "utf8");
}

export interface EncryptedSegment {
  /** AES-GCM IV; safe to send alongside ciphertext. */
  ivHex: string;
  /** Ciphertext followed by the 16-byte GCM authentication tag. */
  body: Buffer;
}

export function encryptSegment(
  plaintext: Uint8Array,
  masterSecret: string,
  sessionToken: string,
  videoId: string,
  segmentIndex: number,
): EncryptedSegment {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSegmentKey(masterSecret, sessionToken), iv);
  cipher.setAAD(segmentAdditionalData(sessionToken, videoId, segmentIndex));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ivHex: iv.toString("hex"),
    body: Buffer.concat([ciphertext, cipher.getAuthTag()]),
  };
}

export function decryptSegmentForTest(
  encrypted: Uint8Array,
  ivHex: string,
  masterSecret: string,
  sessionToken: string,
  videoId: string,
  segmentIndex: number,
): Buffer {
  const packed = Buffer.from(encrypted);
  if (packed.length < 17 || !/^[a-f0-9]{24}$/.test(ivHex)) throw new Error("Invalid segment envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveSegmentKey(masterSecret, sessionToken),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAAD(segmentAdditionalData(sessionToken, videoId, segmentIndex));
  decipher.setAuthTag(packed.subarray(-16));
  return Buffer.concat([decipher.update(packed.subarray(0, -16)), decipher.final()]);
}

export interface WrappedSessionKey {
  serverPublicKey: string;
  wrappedSessionKey: string;
  keyWrapIv: string;
}

export function wrapSessionKeyForClient(
  masterSecret: string,
  sessionToken: string,
  clientPublicKeyBase64Url: string,
): WrappedSessionKey {
  const clientPublicKey = Buffer.from(clientPublicKeyBase64Url, "base64url");
  if (
    clientPublicKey.length !== P256_UNCOMPRESSED_BYTES ||
    clientPublicKey[0] !== 0x04
  ) {
    throw new Error("Invalid P-256 client public key");
  }

  const server = createECDH("prime256v1");
  server.generateKeys();
  const sharedSecret = server.computeSecret(clientPublicKey);
  const wrappingKey = hkdf(sharedSecret, sessionToken, WRAP_INFO);
  const sessionKey = deriveSegmentKey(masterSecret, sessionToken);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  cipher.setAAD(Buffer.from(`zipo:key-wrap:v1\n${sessionToken}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(sessionKey), cipher.final()]);

  return {
    serverPublicKey: server.getPublicKey().toString("base64url"),
    wrappedSessionKey: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64url"),
    keyWrapIv: iv.toString("base64url"),
  };
}

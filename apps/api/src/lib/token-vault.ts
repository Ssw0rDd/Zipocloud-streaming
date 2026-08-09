import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "zipo:v1:a256gcm";
const MAX_SECRET_BYTES = 16_384;

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Token vault payload is malformed");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes != null && decoded.byteLength !== expectedBytes)
  ) {
    throw new Error("Token vault payload is malformed");
  }
  return decoded;
}

function deriveKey(masterKey: string): Buffer {
  if (masterKey.length < 32) throw new Error("Token vault key is too short");
  return createHash("sha256")
    .update("zipo-token-vault-v1\0")
    .update(masterKey)
    .digest();
}

export function isSealedSecret(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export function sealSecret(value: string, masterKey: string, context: string): string {
  const plaintext = Buffer.from(value, "utf8");
  if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_SECRET_BYTES) {
    throw new Error("Token vault value has an invalid size");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(masterKey), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function openSecret(value: string, masterKey: string, context: string): string {
  const [namespace, version, algorithm, iv, tag, ciphertext, extra] = value.split(":");
  if (
    namespace !== "zipo" ||
    version !== "v1" ||
    algorithm !== "a256gcm" ||
    !iv ||
    !tag ||
    !ciphertext ||
    extra
  ) {
    throw new Error("Token vault payload is malformed");
  }
  const ivBytes = decodeCanonicalBase64Url(iv, 12);
  const tagBytes = decodeCanonicalBase64Url(tag, 16);
  const ciphertextBytes = decodeCanonicalBase64Url(ciphertext);
  if (ciphertextBytes.byteLength < 1 || ciphertextBytes.byteLength > MAX_SECRET_BYTES) {
    throw new Error("Token vault payload is malformed");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(masterKey),
    ivBytes,
  );
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tagBytes);
  const plaintext = Buffer.concat([
    decipher.update(ciphertextBytes),
    decipher.final(),
  ]);
  if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_SECRET_BYTES) {
    throw new Error("Token vault plaintext has an invalid size");
  }
  return plaintext.toString("utf8");
}

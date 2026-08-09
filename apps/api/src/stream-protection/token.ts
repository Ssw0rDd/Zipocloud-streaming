import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PROTECTED_STREAM_TTL_MS = 30 * 60_000;
const TOKEN_PATTERN = /^v1\.([A-Za-z0-9_-]{20,1024})\.([A-Za-z0-9_-]{43})$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface ProtectedStreamClaims {
  v: 1;
  userId: string;
  videoId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function signingKey(masterSecret: string): Buffer {
  return createHash("sha256")
    .update("zipo-protected-stream-token\0")
    .update(masterSecret)
    .digest();
}

function signature(payload: string, masterSecret: string): string {
  return createHmac("sha256", signingKey(masterSecret))
    .update(`v1.${payload}`)
    .digest("base64url");
}

function sameSignature(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueProtectedStreamToken(input: {
  userId: string;
  videoId: string;
  masterSecret: string;
  now?: number;
}): { token: string; claims: ProtectedStreamClaims } {
  const now = input.now ?? Date.now();
  if (!input.userId || input.userId.length > 256 || !VIDEO_ID_PATTERN.test(input.videoId)) {
    throw new Error("Invalid protected stream identity");
  }
  const claims: ProtectedStreamClaims = {
    v: 1,
    userId: input.userId,
    videoId: input.videoId,
    issuedAt: now,
    expiresAt: now + PROTECTED_STREAM_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return { token: `v1.${payload}.${signature(payload, input.masterSecret)}`, claims };
}

export function verifyProtectedStreamToken(
  token: string,
  masterSecret: string,
  now = Date.now(),
): ProtectedStreamClaims | null {
  if (token.length > 1_500) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match || !sameSignature(signature(match[1]!, masterSecret), match[2]!)) return null;
  try {
    const claims = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as Partial<ProtectedStreamClaims>;
    if (
      claims.v !== 1 ||
      typeof claims.userId !== "string" ||
      !claims.userId ||
      claims.userId.length > 256 ||
      typeof claims.videoId !== "string" ||
      !VIDEO_ID_PATTERN.test(claims.videoId) ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt) ||
      typeof claims.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/.test(claims.nonce) ||
      claims.expiresAt! - claims.issuedAt! !== PROTECTED_STREAM_TTL_MS ||
      claims.issuedAt! > now + 5_000 ||
      claims.expiresAt! <= now
    ) return null;
    return claims as ProtectedStreamClaims;
  } catch {
    return null;
  }
}

export function protectedStreamTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function validProtectedVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

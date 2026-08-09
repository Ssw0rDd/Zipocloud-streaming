import type { ContentType } from "@zipo/shared";
import { isValidContentId as sharedIsValidContentId } from "@zipo/shared";
import { z } from "zod";
import { contentIdParamsSchema } from "@zipo/shared";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidContentId(type: ContentType | string, id: string): boolean {
  return sharedIsValidContentId(type, id);
}

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export function parseContentIdParams(
  type: string,
  id: string,
): { ok: true; data: z.infer<typeof contentIdParamsSchema> } | { ok: false } {
  const result = contentIdParamsSchema.safeParse({ type, id });
  if (!result.success) return { ok: false };
  if (!isValidContentId(result.data.type, result.data.id)) return { ok: false };
  return { ok: true, data: result.data };
}

export function validateIdOrThrow(
  type: ContentType,
  id: string,
): void {
  if (!isValidContentId(type, id)) {
    throw new IdValidationError(id);
  }
}

export class IdValidationError extends Error {
  status = 400;
  constructor(id: string) {
    super(`Invalid ID format: ${id.slice(0, 32)}`);
    this.name = "IdValidationError";
  }
}

const FUZZ_INVALID_IDS = [
  "",
  " ",
  "../../../etc/passwd",
  "' OR 1=1--",
  "<script>",
  "null",
  "undefined",
  "%00",
  "a".repeat(200),
  "🎬",
];

export function getFuzzInvalidIds(): readonly string[] {
  return FUZZ_INVALID_IDS;
}

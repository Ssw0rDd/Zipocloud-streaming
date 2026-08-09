import sanitizeHtml from "sanitize-html";
import { customAlphabet } from "nanoid";

export function sanitizeComment(body: string): string {
  return sanitizeHtml(body.trim(), {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}

/** Alias used by security test harness */
export function sanitizeUserContent(body: string): string {
  return sanitizeComment(body);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const clipAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nanoid12 = customAlphabet(clipAlphabet, 12);

export function generateClipToken(): string {
  return nanoid12();
}

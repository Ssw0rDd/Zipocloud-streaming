/** Server-safe plain-text sanitization (no jsdom / DOMPurify). */

export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

export function sanitizePlainText(text: string): string {
  return stripHtmlTags(text).trim();
}

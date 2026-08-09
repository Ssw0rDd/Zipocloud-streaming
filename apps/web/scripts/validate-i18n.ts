/**
 * Validates every message file dynamically against the shared locale registry.
 * Run: bun apps/web/scripts/validate-i18n.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "@zipo/shared";

const __dir = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dir, "../messages");
const locales = readdirSync(messagesDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -5))
  .sort();

const expectedLocales = [...SUPPORTED_LOCALES].sort();
if (
  locales.length !== expectedLocales.length ||
  locales.some((locale, index) => locale !== expectedLocales[index])
) {
  console.error(
    `Locale files mismatch. Expected: ${expectedLocales.join(", ")}; found: ${locales.join(", ")}`,
  );
  process.exit(1);
}

type JsonObject = Record<string, unknown>;

function flattenKeys(obj: JsonObject, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as JsonObject, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

function loadLocale(locale: string): JsonObject {
  const raw = readFileSync(join(messagesDir, `${locale}.json`), "utf-8");
  return JSON.parse(raw) as JsonObject;
}

const byLocale = Object.fromEntries(
  locales.map((l) => [l, flattenKeys(loadLocale(l))]),
) as Record<string, string[]>;

const base = byLocale.pt!;
let failed = false;

for (const locale of locales) {
  if (locale === "pt") continue;
  const keys = byLocale[locale];
  const missing = base.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !base.includes(k));
  if (missing.length) {
    console.error(`[${locale}] missing keys:\n  ${missing.join("\n  ")}`);
    failed = true;
  }
  if (extra.length) {
    console.error(`[${locale}] extra keys:\n  ${extra.join("\n  ")}`);
    failed = true;
  }
}

// Scan source for useTranslations namespaces
const srcDir = join(__dir, "..");
const nsUsed = new Set<string>();
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
      walk(p);
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
      const content = readFileSync(p, "utf-8");
      for (const m of content.matchAll(/useTranslations\(\s*["']([^"']+)["']\s*\)/g)) {
        nsUsed.add(m[1]!);
      }
    }
  }
};
walk(srcDir);

for (const ns of nsUsed) {
  if (!(ns in loadLocale("pt"))) {
    console.error(`Namespace "${ns}" used in code but missing from pt.json`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`i18n OK — ${base.length} keys × ${locales.length} locales, ${nsUsed.size} namespaces`);

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const roots = [
  resolve(workspace, "apps/web/.next/static"),
  resolve(workspace, "apps/web/public"),
  resolve(workspace, "packages/api-client/dist"),
  resolve(workspace, "packages/auth-ui/dist"),
];
const readable = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".webmanifest", ".xml"]);
const forbiddenFiles = new Set([".map", ".ts", ".tsx"]);
const findings = [];

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const webStatic = roots[0];
if (!existsSync(webStatic)) {
  console.error("Browser artifact audit requires a production build: apps/web/.next/static is missing.");
  process.exit(2);
}

const secretNames = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "MERCADOPAGO_ACCESS_TOKEN",
  "PROTECTED_STREAM_MASTER_SECRET",
  "REDIS_URL",
  "S3_SECRET_KEY",
  "STREAM_BRIDGE_TOKEN",
  "STREAM_SESSION_SECRET",
  "TOKEN_VAULT_KEY",
];
const secretValues = secretNames
  .map((name) => [name, process.env[name]])
  .filter((entry) => typeof entry[1] === "string" && entry[1].length >= 8);

for (const file of roots.flatMap(walk)) {
  const shown = relative(workspace, file).replaceAll("\\", "/");
  const extension = extname(file).toLowerCase();
  if (forbiddenFiles.has(extension) && !file.endsWith(".d.ts")) {
    findings.push(`${shown}: forbidden source/source-map file`);
    continue;
  }
  if (!readable.has(extension) || statSync(file).size > 20_000_000) continue;
  const body = readFileSync(file, "utf8");
  if (/[/][*#]\s*sourceMappingURL=|[/][/][#@]\s*sourceMappingURL=/.test(body)) {
    findings.push(`${shown}: sourceMappingURL reference`);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) {
    findings.push(`${shown}: private-key material`);
  }
  for (const [name, value] of secretValues) {
    if (body.includes(value)) findings.push(`${shown}: value from ${name}`);
  }
}

if (findings.length > 0) {
  console.error(`Browser artifact audit failed (${findings.length} finding(s)):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Browser artifact audit passed across ${roots.filter(existsSync).length} artifact roots.`);

/**
 * Load monorepo root `.env` into the process, then spawn Next.
 * Next only auto-loads env files under apps/web/, so NEXT_PUBLIC_* in the
 * root `.env` would otherwise never reach the client bundle.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "../..");
const rootEnvPath = path.join(repoRoot, ".env");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const rootEnv = parseEnvFile(rootEnvPath);
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/with-root-env.mjs <command> [...args]");
  process.exit(1);
}

const [command, ...commandArgs] = args;
const isNextBuild =
  commandArgs.some((arg) => /(?:^|[\\/])next(?:\.js)?$/i.test(arg)) &&
  commandArgs.includes("build");
const env = {
  ...rootEnv,
  ...process.env,
  ...(isNextBuild ? { NODE_ENV: "production" } : {}),
};
const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env,
  shell: false,
  cwd: webRoot,
});

child.on("exit", (code) => process.exit(code ?? 0));

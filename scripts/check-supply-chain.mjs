import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const failures = [];
const read = (path) => readFileSync(resolve(workspace, path), "utf8");

for (const path of [
  "services/zipo-stream-bridge/requirements.txt",
  "services/zipo-stream-bridge/requirements-dev.txt",
]) {
  for (const [index, raw] of read(path).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^-r\s+\S+$/.test(line)) continue;
    if (!/^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[^=<>!~\s]+$/.test(line)) {
      failures.push(`${path}:${index + 1}: Python dependency is not exactly pinned`);
    }
  }
}

for (const path of [
  "apps/api/Dockerfile",
  "apps/web/Dockerfile",
  "services/zipo-stream-bridge/Dockerfile",
]) {
  const stages = new Set();
  for (const [index, raw] of read(path).split(/\r?\n/).entries()) {
    const match = raw.match(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+(\S+))?/i);
    if (!match) continue;
    const image = match[1];
    if (!stages.has(image) && (!image.includes(":") || /:latest(?:@|$)/i.test(image))) {
      failures.push(`${path}:${index + 1}: container base is floating`);
    }
    if (match[2]) stages.add(match[2]);
  }
}

for (const path of ["docker-compose.yml", "docker-compose.prod.yml"]) {
  for (const [index, raw] of read(path).split(/\r?\n/).entries()) {
    const match = raw.match(/^\s*image:\s*([^\s#]+)/i);
    if (!match) continue;
    const image = match[1];
    if (!image.includes(":") || /:latest(?:@|$)/i.test(image)) {
      failures.push(`${path}:${index + 1}: service image is floating`);
    }
  }
}

for (const path of [".github/workflows/ci.yml"]) {
  for (const [index, raw] of read(path).split(/\r?\n/).entries()) {
    const match = raw.match(/^\s*-?\s*uses:\s*[^@\s]+@([^\s#]+)/);
    if (match && !/^[a-f0-9]{40}$/.test(match[1])) {
      failures.push(`${path}:${index + 1}: GitHub Action is not pinned to a commit SHA`);
    }
  }
}

const rootPackage = JSON.parse(read("package.json"));
if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? "")) {
  failures.push("package.json: packageManager must use an exact pnpm version");
}
if (!existsSync(resolve(workspace, "pnpm-lock.yaml"))) failures.push("pnpm-lock.yaml is missing");
if (!/minimumReleaseAge:\s*(?:1[4-9]\d\d|[2-9]\d{3,})/.test(read("pnpm-workspace.yaml"))) {
  failures.push("pnpm-workspace.yaml: minimumReleaseAge must be at least 1440 minutes");
}

if (failures.length > 0) {
  console.error(`Supply-chain policy failed (${failures.length} finding(s)):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Supply-chain policy passed.");

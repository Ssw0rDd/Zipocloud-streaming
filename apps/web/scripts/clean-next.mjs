import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directories = [".next", ".next-nsfw", ".next-dev", ".next-dev-nsfw"];
for (const directory of directories) {
  rmSync(join(root, directory), { recursive: true, force: true });
}
console.log(`[clean-next] Removed apps/web/{${directories.join(", ")}}`);

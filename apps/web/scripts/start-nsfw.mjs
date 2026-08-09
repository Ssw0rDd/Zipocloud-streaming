import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Root `.env` sets PORT=3001 for the API — never reuse it for the NSFW web app.
const port = process.env.WEB_PORT || "3002";
const env = {
  ...process.env,
  NEXT_PUBLIC_SITE_MODE: "nsfw",
  NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME || "ZiPo NSFW",
};

const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    port,
  ],
  {
  stdio: "inherit",
  env,
  shell: false,
  cwd: root,
},
);

child.on("exit", (code) => process.exit(code ?? 0));

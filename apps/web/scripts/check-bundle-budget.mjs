import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextRoot = path.join(appRoot, ".next");
const manifestPath = path.join(nextRoot, "app-build-manifest.json");

const routeBudgets = [
  { route: "/[locale]/page", label: "home", rawKiB: 850, gzipKiB: 260 },
  { route: "/[locale]/movie/[id]/page", label: "detail", rawKiB: 850, gzipKiB: 265 },
  { route: "/[locale]/watch/[type]/[id]/page", label: "watch", rawKiB: 870, gzipKiB: 270 },
  { route: "/[locale]/cinema/[token]/page", label: "cinema", rawKiB: 900, gzipKiB: 275 },
  { route: "/[locale]/profile/page", label: "profile", rawKiB: 850, gzipKiB: 265 },
];

if (!fs.existsSync(manifestPath)) {
  throw new Error("Missing .next/app-build-manifest.json; run the production build first");
}

const { pages } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const layoutFiles = pages["/[locale]/layout"];
if (!Array.isArray(layoutFiles)) throw new Error("Locale layout is missing from build manifest");

function measure(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const contents = fs.readFileSync(path.join(nextRoot, file));
    raw += contents.byteLength;
    gzip += gzipSync(contents).byteLength;
  }
  return { rawKiB: raw / 1024, gzipKiB: gzip / 1024 };
}

const failures = [];
console.log("Route bundle budgets (layout + page JavaScript)");
for (const budget of routeBudgets) {
  const pageFiles = pages[budget.route];
  if (!Array.isArray(pageFiles)) {
    failures.push(`${budget.label}: route ${budget.route} is missing`);
    continue;
  }
  const files = [...new Set([...layoutFiles, ...pageFiles])].filter((file) => file.endsWith(".js"));
  const size = measure(files);
  console.log(
    `${budget.label.padEnd(8)} ${size.rawKiB.toFixed(1).padStart(6)} / ${budget.rawKiB} KiB raw  ` +
      `${size.gzipKiB.toFixed(1).padStart(6)} / ${budget.gzipKiB} KiB gzip`,
  );
  if (size.rawKiB > budget.rawKiB) failures.push(`${budget.label}: raw JavaScript budget exceeded`);
  if (size.gzipKiB > budget.gzipKiB) failures.push(`${budget.label}: gzip JavaScript budget exceeded`);
}

const cssFiles = [...new Set(layoutFiles)].filter((file) => file.endsWith(".css"));
const cssSize = measure(cssFiles);
console.log(
  `css      ${cssSize.rawKiB.toFixed(1).padStart(6)} / 130 KiB raw  ` +
    `${cssSize.gzipKiB.toFixed(1).padStart(6)} / 22 KiB gzip`,
);
if (cssSize.rawKiB > 130) failures.push("layout CSS raw budget exceeded");
if (cssSize.gzipKiB > 22) failures.push("layout CSS gzip budget exceeded");

if (failures.length) {
  console.error(`\nBundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}

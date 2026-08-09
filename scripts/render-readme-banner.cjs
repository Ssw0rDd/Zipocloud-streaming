const fs = require("fs");
const sharp = require(require.resolve("sharp", { paths: ["apps/api", "apps/web", "."] }));

async function main() {
  const svg = fs.readFileSync("docs/assets/zipo-banner.svg");
  const buf = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n'),
    svg,
  ]);

  const info = await sharp(buf, { density: 200 }).png().toFile("docs/assets/zipo-banner.png");
  console.log("banner", info);

  const logoSvg = fs.readFileSync("docs/assets/zipo-logo.svg");
  const logoBuf = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n'),
    logoSvg,
  ]);
  const logoInfo = await sharp(logoBuf, { density: 200 }).png().toFile("docs/assets/zipo-logo.png");
  console.log("logo", logoInfo);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

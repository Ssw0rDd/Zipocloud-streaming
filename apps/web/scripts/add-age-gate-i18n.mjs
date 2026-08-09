import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../messages");
const block = `  "ageGate": {
    "title": "Adults only (18+)",
    "description": "This site contains adult movies, series and anime (including ecchi, hentai and pornographic content). By continuing you confirm you are 18 or older.",
    "confirm": "I am 18 or older",
    "confirming": "Confirming…",
    "leave": "Leave",
    "error": "Could not confirm. Try again."
  },
`;

for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "pt.json")) {
  const full = path.join(dir, file);
  let text = fs.readFileSync(full, "utf8");
  if (text.includes('"ageGate"')) continue;
  if (!text.includes('"nav":')) {
    console.warn("skip", file);
    continue;
  }
  text = text.replace(/\n  "nav":/, `\n${block}  "nav":`);
  fs.writeFileSync(full, text);
  console.log("updated", file);
}

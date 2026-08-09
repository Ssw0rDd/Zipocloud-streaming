import { describe, expect, test } from "bun:test";
import { createProductionApp } from "../../src/index";

describe("production not-found handling", () => {
  test("returns a redacted 404 for unknown and sensitive-looking paths", async () => {
    const app = createProductionApp();
    for (const path of ["/.env", "/.git/config", "/src/index.ts", "/index.js.map"]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found", code: "NOT_FOUND" });
    }
  });
});

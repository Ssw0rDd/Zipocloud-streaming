import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text();
}

describe("job leader availability", () => {
  test("contains Redis failures and prevents renewal rejection crashes", async () => {
    const implementation = await source("src/lib/job-leader.ts");
    expect(implementation).toContain("} catch {");
    expect(implementation).toContain("isLeader = false;");
    expect(implementation).toContain("tryBecomeJobLeader().catch");
  });
});

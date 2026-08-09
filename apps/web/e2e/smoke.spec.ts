import { test, expect } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

for (const vp of viewports) {
  test.describe(`smoke ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("home loads shell", async ({ page }) => {
      await page.goto("/pt");
      await expect(page.locator("body")).toBeVisible();
      // Brand or main landmark should appear quickly
      await expect(page.locator("main, [data-zp='home'], body").first()).toBeVisible({
        timeout: 15_000,
      });
    });

    test("search page opens", async ({ page }) => {
      await page.goto("/pt/search");
      await expect(page.locator("body")).toBeVisible();
    });
  });
}

test("health live is ok", async ({ request }) => {
  const api = process.env.API_URL ?? "http://localhost:3001";
  const res = await request.get(`${api}/health/live`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
});

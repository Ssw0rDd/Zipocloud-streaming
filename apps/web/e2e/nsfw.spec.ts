import { expect, test } from "@playwright/test";

test.describe("NSFW storefront", () => {
  test.skip(process.env.E2E_NSFW !== "true", "Run against the NSFW frontend");

  test.beforeEach(async ({ page }) => {
    const item = {
      id: "e2e-title",
      type: "movie",
      title: "Noite de Teste",
      description: "Uma seleção adulta usada para validar a experiência visual.",
      year: 2026,
      rating: 8.4,
      isAdult: true,
      access: { canView: true },
    };

    await page.route("**/api/auth/get-session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "e2e-adult",
            name: "E2E Adult",
            email: "adult@example.test",
            isSupporter: false,
            adultConfirmedAt: "2026-01-01T00:00:00.000Z",
          },
          session: {
            id: "e2e-session",
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
        }),
      });
    });
    await page.route("**/api/v1/account/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-adult",
          name: "E2E Adult",
          email: "adult@example.test",
          image: null,
          isSupporter: false,
          adultConfirmed: true,
          adultConfirmedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
    });
    await page.route("**/api/v3/home?*", async (route) => {
      const items = Array.from({ length: 12 }, (_, index) => ({
        ...item,
        id: `e2e-movie-${index + 1}`,
        title: `Noite de Teste ${index + 1}`,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            featured: {
              movies: [item],
              series: [],
              anime: [],
              source: "e2e",
            },
            sections: [
              { id: "movies", title: "Filmes", type: "movie", items },
              {
                id: "series",
                title: "Séries",
                type: "series",
                items: items.map((entry) => ({ ...entry, type: "series" })),
              },
              {
                id: "anime",
                title: "Anime",
                type: "anime",
                items: items.map((entry) => ({ ...entry, type: "anime" })),
              },
            ],
          },
          meta: {
            generatedAt: "2026-01-01T00:00:00.000Z",
            stale: false,
            partial: false,
            cacheStatus: "fresh",
          },
        }),
      });
    });
    await page.route("**/api/v1/catalog/*", async (route) => {
      const url = new URL(route.request().url());
      const type = url.pathname.split("/").at(-1) ?? "movie";
      const items = Array.from({ length: 12 }, (_, index) => ({
        ...item,
        id: `e2e-${type}-${index + 1}`,
        type,
        title: `Título ${index + 1}`,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type,
          items,
          total: items.length,
          skip: 0,
          limit: 24,
        }),
      });
    });
  });

  test("renders the adult home without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pt", { waitUntil: "domcontentloaded" });

    await expect(page.locator("body")).toHaveClass(/site-nsfw/);
    await expect(page.locator("[data-zp='home']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /^assistir$/i })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  });

  for (const type of ["movie", "series", "anime"] as const) {
    test(`renders the ${type} catalog`, async ({ page }) => {
      await page.goto(`/pt/explore/${type}`, { waitUntil: "domcontentloaded" });

      await expect(page.locator(".nsfw-explore")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /filtrar gêneros/i })).toBeVisible();
      await expect(page.getByRole("link", { name: "Título 1", exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
  }
});

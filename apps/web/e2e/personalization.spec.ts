import { expect, test, type Page } from "@playwright/test";

const profileId = "11111111-1111-4111-8111-111111111111";

const items = Array.from({ length: 18 }, (_, index) => ({
  id: `tt${String(1_000_000 + index)}`,
  type: index % 3 === 0 ? "series" : "movie",
  title: `Título personalizado ${index + 1}`,
  description: "Uma seleção baseada no histórico deste perfil.",
  year: 2026 - (index % 6),
  rating: 8.8 - index * 0.1,
  genres: index % 2 ? ["Drama"] : ["Ação"],
  isAdult: false,
  access: { canView: true },
}));

async function mockAccount(page: Page) {
  await page.addInitScript((id) => localStorage.setItem("zipo-active-profile", id), profileId);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "e2e-member", name: "Conta Teste", email: "member@example.test", isSupporter: false },
      session: { id: "e2e-session", expiresAt: "2030-01-01T00:00:00.000Z" },
    }),
  }));
}

test.beforeEach(async ({ page }) => {
  await mockAccount(page);
  await page.route("**/api/v2/home?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      profileId,
      personalized: true,
      hero: items[0],
      sections: [
        {
          id: "continue",
          title: "Continue assistindo",
          layout: "landscape",
          items: [{ ...items[1], progress: { episodeId: null, seasonNumber: 1, episodeNumber: 2, progressSeconds: 900, durationSeconds: 2400, updatedAt: "2026-07-30T12:00:00.000Z" } }],
        },
        { id: "for-you", title: "Para você", layout: "poster", items: items.slice(0, 12) },
        { id: "because", title: "Porque combina com você", layout: "poster", items: items.slice(12) },
        { id: "trending", title: "Em alta", layout: "ranked", items: items.slice(0, 6) },
      ],
      reasons: Object.fromEntries(items.map((item) => [`${item.type}:${item.id}`, "Selecionado para você"])),
    }),
  }));
  await page.route("**/api/v2/recommendation-events", (route) => route.fulfill({ status: 202, contentType: "application/json", body: "{\"accepted\":true}" }));
  await page.route("**/api/v2/profiles", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profiles: [{ id: profileId, userId: "e2e-member", name: "Conta Teste", avatarKey: "pistachio", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], limit: 1, remaining: 0 }),
  }));
  await page.route("**/api/v1/donate/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ enabled: false, amountCents: null, currency: "BRL", entitlement: "lifetime_supporter" }),
  }));
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`personalized home is polished without overflow at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/pt", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Título personalizado 1", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Continuar assistindo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Para você" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (process.env.E2E_SCREENSHOTS === "true") {
      await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true });
    }
  });
}

test("profile hub exposes profile selection, legacy import and safe Pix state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pt/profile", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Perfis e benefícios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quem está assistindo?" })).toBeVisible();
  await expect(page.getByText("Trazer histórico antigo")).toBeVisible();
  await expect(page.getByText("Pagamento Pix indisponível no momento.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (process.env.E2E_SCREENSHOTS === "true") {
    await page.screenshot({ path: testInfo.outputPath("profile-390.png"), fullPage: true });
  }
});

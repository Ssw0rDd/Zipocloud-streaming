import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../../../${path}`, import.meta.url)).text();
}

describe("web Content Security Policy", () => {
  test("uses a per-request script nonce without unsafe inline scripts", async () => {
    const [middleware, policy, layout, nextConfig] = await Promise.all([
      source("apps/web/middleware.ts"),
      source("apps/web/lib/security-policy.ts"),
      source("apps/web/app/[locale]/layout.tsx"),
      source("apps/web/next.config.ts"),
    ]);

    expect(middleware).toContain("crypto.randomUUID()");
    expect(middleware).toContain('headers.set("x-nonce", nonce)');
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    const scriptDirective = policy
      .split(/\r?\n/)
      .find((line) => line.includes("`script-src 'self'"));
    expect(scriptDirective).toBeDefined();
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(layout).toContain('dynamic = "force-dynamic"');
    expect(layout).toContain("await headers()");
    expect(layout).not.toContain("generateStaticParams");
    expect(nextConfig).not.toContain('key: "Content-Security-Policy"');
  });
});

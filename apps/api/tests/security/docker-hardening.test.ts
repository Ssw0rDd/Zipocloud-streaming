import { describe, expect, test } from "bun:test";

async function repositoryFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(`../../../../${relativePath}`, import.meta.url)).text();
}

describe("container build hardening", () => {
  test("uses the pinned package manager and never falls back from the lockfile", async () => {
    const [rootPackage, apiDockerfile, webDockerfile] = await Promise.all([
      repositoryFile("package.json"),
      repositoryFile("apps/api/Dockerfile"),
      repositoryFile("apps/web/Dockerfile"),
    ]);
    const packageManager = JSON.parse(rootPackage).packageManager as string;

    expect(apiDockerfile).toContain(packageManager);
    expect(apiDockerfile).toContain("pnpm install --frozen-lockfile");
    expect(webDockerfile).toContain("pnpm install --frozen-lockfile");
    expect(webDockerfile).not.toContain("|| pnpm install");
  });

  test("application containers do not run as root", async () => {
    const [apiDockerfile, webDockerfile, bridgeDockerfile] = await Promise.all([
      repositoryFile("apps/api/Dockerfile"),
      repositoryFile("apps/web/Dockerfile"),
      repositoryFile("services/zipo-stream-bridge/Dockerfile"),
    ]);

    expect(apiDockerfile).toMatch(/\nUSER\s+(?!root\b)\S+/);
    expect(webDockerfile).toMatch(/\nUSER\s+(?!root\b)\S+/);
    expect(bridgeDockerfile).toMatch(/\nUSER\s+(?!root\b)\S+/);
  });

  test("production compose has no floating latest image and hardens app processes", async () => {
    const compose = await repositoryFile("docker-compose.prod.yml");
    expect(compose).not.toMatch(/image:\s*\S+:latest/);
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("./nginx/nginx.prod.conf");
    expect(compose).toContain('"443:8443"');
  });
});

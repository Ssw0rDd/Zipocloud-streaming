import { describe, expect, test } from "bun:test";

const nginxConfigUrls = [
  new URL("../../../../nginx/nginx.conf", import.meta.url),
  new URL("../../../../nginx/nginx.prod.conf", import.meta.url),
];

describe("Nginx sensitive URL logging", () => {
  test("does not persist bearer-style media tokens from URLs", async () => {
    const configs = await Promise.all(nginxConfigUrls.map((url) => Bun.file(url).text()));

    for (const config of configs) {
      expect(config).toContain("$zipo_access_loggable");
      expect(config).toMatch(/playback\/sessions\/.*stream/);
      expect(config).toMatch(/playback\/media\/.*authorized.*megafrix/);
      expect(config).toMatch(/playback\/preparations/);
      expect(config).toMatch(/access_log\s+\S+\s+main\s+if=\$zipo_access_loggable/);
    }
  });

  test("production edge terminates modern TLS and redirects plaintext HTTP", async () => {
    const config = await Bun.file(nginxConfigUrls[1]).text();
    expect(config).toContain("listen 8443 ssl");
    expect(config).toContain("ssl_protocols TLSv1.2 TLSv1.3");
    expect(config).toContain("return 308 https://$host$request_uri");
    expect(config).toContain("Strict-Transport-Security");
  });
});

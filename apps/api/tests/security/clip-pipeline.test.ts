import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(resolve(import.meta.dir, "../../src/routes/clips.ts"), "utf8");
const composeSource = readFileSync(resolve(import.meta.dir, "../../../../docker-compose.prod.yml"), "utf8");

describe("clip pipeline lifecycle", () => {
  it("separates the API product flag from the worker process role", () => {
    expect(routeSource).toContain("env.CLIPS_ENABLED");
    expect(routeSource).not.toContain("if (!env.MEDIA_WORKER_ENABLED)");
    expect(composeSource).toContain("CLIPS_ENABLED: ${CLIPS_ENABLED:-false}");
    expect(composeSource).toContain('MEDIA_WORKER_ENABLED: "false"');
    expect(composeSource).toContain('MEDIA_WORKER_ENABLED: "true"');
  });

  it("reserves a user slot only after site and content checks", () => {
    const createRoute = routeSource.slice(
      routeSource.indexOf('.post("/clips"'),
      routeSource.indexOf('.get(\n    "/clips/:token"'),
    );
    expect(createRoute.indexOf("assertItemForSite")).toBeGreaterThan(-1);
    expect(createRoute.indexOf("acquireClipSlot")).toBeGreaterThan(
      createRoute.indexOf("assertItemForSite"),
    );
  });

  it("marks persisted retry jobs as failed when enqueue fails", () => {
    const retryRoute = routeSource.slice(routeSource.indexOf('.post("/clips/:token/retry"'));
    expect(retryRoute).toContain('status: "failed"');
    expect(retryRoute).toContain('errorCode: error instanceof QueueBackpressureError');
    expect(retryRoute).toContain("releaseClipSlot(session.user.id)");
  });
});

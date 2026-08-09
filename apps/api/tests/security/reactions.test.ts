import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, json } from "../helpers/test-app";

interface ReactionResponse {
  likes: number;
  dislikes: number;
  userReaction?: "like" | "dislike";
}

describe("SEC-R01 to SEC-R04 — Reactions security", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("SEC-R01: like/dislike toggle e remove", async () => {
    const headers = {
      "Content-Type": "application/json",
      "x-user-id": "reactor-1",
    };

    const liked = await json<ReactionResponse>(app, "/reactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        contentType: "movie",
        contentId: "tt0111161",
        reaction: "like",
      }),
    });
    expect(liked.status).toBe(200);
    expect(liked.body.likes).toBe(1);
    expect(liked.body.userReaction).toBe("like");

    const switched = await json<ReactionResponse>(app, "/reactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        contentType: "movie",
        contentId: "tt0111161",
        reaction: "dislike",
      }),
    });
    expect(switched.status).toBe(200);
    expect(switched.body.likes).toBe(0);
    expect(switched.body.dislikes).toBe(1);
    expect(switched.body.userReaction).toBe("dislike");

    const removed = await json<ReactionResponse>(app, "/reactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        contentType: "movie",
        contentId: "tt0111161",
        reaction: "remove",
      }),
    });
    expect(removed.status).toBe(200);
    expect(removed.body.dislikes).toBe(0);
    expect(removed.body.userReaction).toBeUndefined();
  });

  test("SEC-R02: IDOR — sessão de outro user não remove reação", async () => {
    await json(app, "/reactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": "owner-session",
      },
      body: JSON.stringify({
        contentType: "anime",
        contentId: "12345",
        reaction: "like",
      }),
    });

    const attacker = await json<ReactionResponse>(app, "/reactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": "attacker-session",
      },
      body: JSON.stringify({
        contentType: "anime",
        contentId: "12345",
        reaction: "remove",
      }),
    });
    expect(attacker.status).toBe(200);
    expect(attacker.body.likes).toBe(1);

    const ownerView = await json<ReactionResponse>(
      app,
      "/reactions/anime/12345",
      { headers: { "x-session-id": "owner-session" } },
    );
    expect(ownerView.body.userReaction).toBe("like");
  });

  test("SEC-R03: IDs inválidos rejeitados", async () => {
    const invalid = await json<{ error: string }>(app, "/reactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "u1",
      },
      body: JSON.stringify({
        contentType: "movie",
        contentId: "../../../etc/passwd",
        reaction: "like",
      }),
    });
    expect(invalid.status).toBe(400);
  });

  test("SEC-R04: rate limit 30 reações/min", async () => {
    const limitedApp = createTestApp({ reactionRateLimitMax: 30 });
    const headers = {
      "Content-Type": "application/json",
      "x-user-id": "heavy-reactor",
      "x-forwarded-for": "10.0.0.77",
    };

    for (let i = 0; i < 30; i++) {
      const res = await json(limitedApp, "/reactions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: "movie",
          contentId: `tt${String(i).padStart(7, "0")}`,
          reaction: "like",
        }),
      });
      expect(res.status).toBe(200);
    }

    const blocked = await json(limitedApp, "/reactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        contentType: "movie",
        contentId: "tt9999999",
        reaction: "like",
      }),
    });
    expect(blocked.status).toBe(429);
  });
});

import { describe, expect, test } from "bun:test";
import {
  canonicalizeGenres,
  cinemaDriftCorrection,
  imageCandidates,
  matchesAnyGenre,
} from "@zipo/shared";
import { issueCinemaAccess, verifyCinemaAccess } from "../../src/cinema/service";
import { streamPlaybackServer } from "../../src/playback/sessions";
import { isValidPlaybackIssueReport, playbackOwnerKey } from "../../src/routes/playback-sessions";
import { playbackV2Routes } from "../../src/routes/playback-v2";

describe("ZiPo V2 shared rules", () => {
  test("genre taxonomy normalizes labels and applies OR semantics", () => {
    expect(canonicalizeGenres(["Ação", "Science Fiction", "terror", "ação"]))
      .toEqual(["action", "science-fiction", "horror"]);
    expect(matchesAnyGenre(["Drama", "Comédia"], ["horror", "comedy"])).toBe(true);
    expect(matchesAnyGenre(["Drama"], ["horror", "comedy"])).toBe(false);
  });

  test("image candidates accept HTTPS URLs and same-origin pipeline paths", () => {
    expect(imageCandidates(
      "http://unsafe.example/poster.jpg",
      "https://cdn.example/poster.jpg",
      "https://cdn.example/poster.jpg",
      "/api/v1/images/abc123XYZ_-def4567890",
      "/api/v1/images/../evil",
      "javascript:alert(1)",
      undefined,
    )).toEqual([
      "https://cdn.example/poster.jpg",
      "/api/v1/images/abc123XYZ_-def4567890",
    ]);
  });

  test("Cinema drift ignores, smooths and seeks at the documented thresholds", () => {
    expect(cinemaDriftCorrection(10, 10.749, 1)).toEqual({ action: "none", playbackRate: 1 });
    expect(cinemaDriftCorrection(10, 10.75, 1)).toEqual({ action: "speed", playbackRate: 1.05 });
    expect(cinemaDriftCorrection(10, 9.25, 1)).toEqual({ action: "speed", playbackRate: 0.95 });
    expect(cinemaDriftCorrection(10, 12.001, 1)).toEqual({ action: "seek", positionSeconds: 12.001, playbackRate: 1 });
  });

  test("Cinema access rejects tampering and expiration", () => {
    const access = {
      v: 1,
      roomId: "7d9ee348-099a-4f6c-961c-f1b7e9135e71",
      roomToken: "A".repeat(32),
      participantId: "B".repeat(16),
      userId: "user-1",
      name: "Host",
      guest: false,
      subjectKey: "user:user-1",
      exp: Date.now() + 60_000,
    };
    const token = issueCinemaAccess(access);
    expect(verifyCinemaAccess(token)).toMatchObject({ roomId: access.roomId, participantId: access.participantId });
    const replacement = token.endsWith("x") ? "y" : "x";
    expect(verifyCinemaAccess(`${token.slice(0, -1)}${replacement}`)).toBeNull();
    expect(verifyCinemaAccess(issueCinemaAccess({ ...access, exp: Date.now() - 1 }))).toBeNull();
  });

  test("unknown or expired playback sessions fail closed", async () => {
    const response = await streamPlaybackServer(
      "invalid-session",
      "x".repeat(43),
      "server-1",
      new Request("http://localhost/stream"),
      "guest:test",
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  test("guest playback ownership uses the HttpOnly visitor session, not spoofable IP headers", () => {
    const request = new Request("http://localhost/stream", {
      headers: {
        Cookie: "zipo_sid=abcdefghijklmnopqrstuvwx",
        "X-Forwarded-For": "1.2.3.4",
      },
    });
    expect(playbackOwnerKey(request)).toBe("session:abcdefghijklmnopqrstuvwx");
    expect(playbackOwnerKey(new Request("http://localhost/stream", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    }))).toBe("session:missing");
  });

  test("playback issue reports reject hostile identifiers and unknown codes", () => {
    expect(isValidPlaybackIssueReport({
      contentType: "movie",
      contentId: "https://evil.example/stream",
      code: "PLAYBACK_FAILED",
    })).toBe(false);
    expect(isValidPlaybackIssueReport({
      contentType: "movie",
      contentId: "tt0111161",
      code: "INJECTED_CODE",
    })).toBe(false);
    expect(isValidPlaybackIssueReport({
      contentType: "movie",
      contentId: "tt0111161",
      code: "PLAYBACK_FAILED",
    })).toBe(true);
  });

  test("playback rejects fractional seasons without a TypeBox union", async () => {
    const response = await playbackV2Routes.handle(new Request(
      "http://localhost/api/v2/playback/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: "movie",
          contentId: "tt0111161",
          season: 1.5,
        }),
      },
    ));
    expect(response.status).toBe(422);
  });
});

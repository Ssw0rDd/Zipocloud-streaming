import { describe, expect, test } from "bun:test";
import { auth } from "../../src/auth";
import { env } from "../../src/env";

describe("authentication configuration", () => {
  test("uses single-factor password length and an explicit maximum", () => {
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(15);
    expect(auth.options.emailAndPassword?.maxPasswordLength).toBe(128);
  });

  test("forces secure cookies in production", () => {
    expect(auth.options.advanced?.useSecureCookies).toBe(env.NODE_ENV === "production");
  });
});

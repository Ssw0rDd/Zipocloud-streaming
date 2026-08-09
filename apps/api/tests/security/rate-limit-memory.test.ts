import { beforeEach, describe, expect, it } from "bun:test";
import {
  checkMemoryRateLimit,
  MEMORY_RATE_LIMIT_MAX_KEYS,
  resetRateLimitStores,
} from "../../src/plugins/rate-limit";

describe("in-memory rate-limit fallback", () => {
  beforeEach(() => resetRateLimitStores());

  it("bounds attacker-controlled keys and evicts the oldest window", () => {
    const config = { max: 5, windowMs: 60_000, keyPrefix: "bounded-test" };
    for (let index = 0; index <= MEMORY_RATE_LIMIT_MAX_KEYS; index += 1) {
      checkMemoryRateLimit(`address-${index}`, config);
    }

    expect(checkMemoryRateLimit("address-0", config).count).toBe(1);
    expect(
      checkMemoryRateLimit(`address-${MEMORY_RATE_LIMIT_MAX_KEYS}`, config).count,
    ).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { localNoLoginApplies, localNoLoginEnabled } from "@/server/auth/local-mode";

const on = { LOCAL_NO_LOGIN: "true", NODE_ENV: "development" };
const headers = (h: Record<string, string>) => new Headers(h);

describe("local no-login mode", () => {
  it("is off unless switched on, and never in production", () => {
    expect(localNoLoginEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(localNoLoginEnabled({ ...on, LOCAL_NO_LOGIN: "false" })).toBe(false);
    expect(localNoLoginEnabled(on)).toBe(true);
    expect(localNoLoginEnabled({ ...on, NODE_ENV: "production" })).toBe(false);
  });

  it("applies only to requests addressed to localhost from this computer", () => {
    expect(localNoLoginApplies(headers({ host: "localhost:3000" }), on)).toBe(true);
    expect(localNoLoginApplies(headers({ host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1" }), on)).toBe(true);
    expect(localNoLoginApplies(headers({ host: "[::1]:3000", "x-forwarded-for": "::1" }), on)).toBe(true);
    expect(localNoLoginApplies(headers({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }), on)).toBe(true);

    // Another device on the network, or a web page using DNS rebinding.
    expect(localNoLoginApplies(headers({ host: "192.168.1.236:3000" }), on)).toBe(false);
    expect(localNoLoginApplies(headers({ host: "attacker.example" }), on)).toBe(false);
    expect(localNoLoginApplies(headers({ host: "localhost.attacker.example" }), on)).toBe(false);
    expect(localNoLoginApplies(headers({ host: "localhost:3000", "x-forwarded-for": "192.168.1.50" }), on)).toBe(false);
    expect(localNoLoginApplies(headers({}), on)).toBe(false);

    // Switched off.
    expect(localNoLoginApplies(headers({ host: "localhost:3000" }), { NODE_ENV: "development" })).toBe(false);
  });
});

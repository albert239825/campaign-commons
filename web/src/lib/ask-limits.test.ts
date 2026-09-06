import { describe, expect, it } from "vitest";
import { AskLimiter, clientKey } from "./ask-limits";

describe("AskLimiter", () => {
  it("refills the per-client bucket over a minute, independently per client", () => {
    let t = 0;
    const l = new AskLimiter(10, 4, () => t);
    for (let i = 0; i < 10; i++) expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
    expect(l.take("b")).toBe(true);
    t = 30_000; // half a window → five tokens back
    for (let i = 0; i < 5; i++) expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
    t = 120_000; // never above the cap
    for (let i = 0; i < 10; i++) expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
  });
  it("caps in-flight work and releases exactly once", () => {
    const l = new AskLimiter(10, 2);
    const r1 = l.acquire();
    const r2 = l.acquire();
    expect(r1 && r2).toBeTruthy();
    expect(l.acquire()).toBeNull();
    r1!();
    r1!();
    expect(l.acquire()).not.toBeNull();
    expect(l.acquire()).toBeNull();
  });
});

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for, then x-real-ip, then a shared bucket", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientKey(new Headers())).toBe("anonymous");
  });
});

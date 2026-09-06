import { describe, expect, it } from "vitest";
import { ribbonTitle } from "./explore-sankey";

describe("ribbonTitle", () => {
  it("labels inferred links as model-read and unverified", () => {
    const from = { id: "org:TRUIST", name: "TRUIST", kind: "organization" as const, href: null, title: null, layer: 0 };
    const to = { id: "C1", name: "PAC", kind: "committee" as const, href: null, title: null, layer: 1 };
    const link = {
      n: 1,
      source: from.id,
      target: to.id,
      rel: "GAVE" as const,
      amount: 100,
      visibility: "disclosed" as const,
      class_basis: "inferred" as const,
      support_oppose: null,
      source_url: null,
    };
    expect(ribbonTitle(link, from, to)).toContain("model-read, unverified");
  });
});

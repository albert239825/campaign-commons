import { describe, expect, it } from "vitest";
import { alignVerdict, USER_VIEW_LABELS } from "./align-verdict";

describe("alignVerdict", () => {
  it("returns no_view for every candidate state when the user has not chosen a view", () => {
    for (const candidate of [
      { record: undefined, model: undefined },
      { record: undefined, model: null },
      { record: undefined, model: 1 },
      { record: -2, model: 2 },
    ]) {
      expect(alignVerdict(null, candidate.record, candidate.model)).toMatchObject({
        verdict: "no_view",
        user: null,
      });
    }
  });

  it("returns no_record when neither source has a direction", () => {
    expect(alignVerdict(0, undefined, null)).toEqual({
      verdict: "no_record",
      basis: null,
      user: 0,
      candidate: null,
      reason: "No coded position or model-proposed direction on file.",
    });
  });

  it("uses a model-proposed direction when there is no coded record", () => {
    expect(alignVerdict(1, undefined, -1)).toMatchObject({ verdict: "mixed", basis: "model", candidate: -1 });
    expect(alignVerdict(1, undefined, -1).reason).toContain("model-proposed direction (unreviewed)");
  });

  it("prefers the coded record over a differing model direction", () => {
    expect(alignVerdict(2, 2, -2)).toMatchObject({ verdict: "aligned", basis: "record", candidate: 2 });
  });

  it.each([
    [-2, -1, "aligned"],
    [-2, 0, "mixed"],
    [-2, 1, "opposed"],
    [-2, 2, "opposed"],
    [0, 0, "aligned"],
    [0, 1, "aligned"],
    [0, 2, "mixed"],
    [2, 0, "mixed"],
    [2, -1, "opposed"],
    [2, -2, "opposed"],
  ] as const)("classifies user %d and candidate %d as %s", (user, candidate, verdict) => {
    expect(alignVerdict(user, candidate, null).verdict).toBe(verdict);
  });

  it("returns the five axis labels in direction order", () => {
    expect(USER_VIEW_LABELS("abortion")).toEqual([
      "strongly: Restrict abortion access",
      "leans: Restrict abortion access",
      "mixed / neutral",
      "leans: Protect abortion access in federal law",
      "strongly: Protect abortion access in federal law",
    ]);
  });
});

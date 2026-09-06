// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RaceSummary } from "@campaign-commons/contracts";
import { RaceNav } from "./race-nav";

const race = { race_id: "pa-sen-2024" } as RaceSummary;

afterEach(cleanup);

describe("RaceNav", () => {
  it("omits Money Trails unless enabled", () => {
    const { rerender } = render(<RaceNav race={race} counts={{ ads: 3 }} active="/" />);
    expect(screen.queryByRole("link", { name: "Money Trails" })).toBeNull();

    rerender(<RaceNav race={race} counts={{ ads: 3 }} active="/" trails />);
    expect(screen.getByRole("link", { name: "Money Trails" }).getAttribute("href")).toBe("/races/pa-sen-2024/ask");
  });
});

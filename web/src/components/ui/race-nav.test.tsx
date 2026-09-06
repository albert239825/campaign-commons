// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceSummary } from "@campaign-commons/contracts";
import { usePathname } from "next/navigation";
import { RaceNav } from "./race-nav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

const race = { race_id: "pa-sen-2024" } as RaceSummary;

afterEach(cleanup);

describe("RaceNav", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/races/pa-sen-2024/ask/committee_funding/C1");
  });

  it("marks the Money Trails tab active on Ask subpages", () => {
    render(<RaceNav race={race} counts={{ ads: 3 }} trails />);
    expect(screen.getByRole("link", { name: "Money Trails" }).getAttribute("aria-current")).toBe("page");
  });

  it("omits Money Trails unless enabled", () => {
    render(<RaceNav race={race} counts={{ ads: 3 }} />);
    expect(screen.queryByRole("link", { name: "Money Trails" })).toBeNull();
  });
});

// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFS_KEY } from "@/lib/prefs";
import { AlignPanel } from "./align-panel";

vi.mock("@campaign-commons/contracts", async () => {
  const { z } = await import("zod");
  const issues = [{ id: "guns", label: "Guns", description: "Firearms regulation, background checks, manufacturer liability." }];
  return {
    ISSUE_AXES: { guns: { plus: "Stricter firearms regulation", minus: "Fewer restrictions on firearms" } },
    ISSUES: issues,
    IssueIdSchema: z.enum(["guns"]),
  };
});

vi.mock("@/components/ui", () => ({
  AdjacencyNote: () => <p>Same topic is the only link.</p>,
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Money: ({ amount }: { amount: number }) => <span>{amount}</span>,
  SourceLink: ({ href, label = "source" }: { href: string; label?: string }) => <a href={href}>{label}</a>,
}));

vi.mock("@/components/ui/party-tag", () => ({
  PartyTag: ({ party }: { party: string }) => <span>{party}</span>,
}));

type TestCandidateStance = Parameters<typeof AlignPanel>[0]["candidates"][number];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const issue = { id: "guns", label: "Guns", description: "Firearms regulation, background checks, manufacturer liability." } as Parameters<typeof AlignPanel>[0]["issue"];

const candidate = (id = "C1", name = "Alice Doe", direction = 1): TestCandidateStance =>
  ({
    candidate: { candidate_id: id, name, party: "DEM", incumbent: false, principal_committee_id: "P1" },
    stance: { issue_id: issue.id, position: "Supports the issue record.", direction, confidence: "high", needs_review: false, evidence: [] },
    machine: undefined,
    hasDossier: true,
  }) as TestCandidateStance;

const renderPanel = (candidates = [candidate()]) => render(<AlignPanel raceId="pa-sen-2024" issue={issue} candidates={candidates} />);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AlignPanel", () => {
  it("persists a view in the shared prefs key and re-renders the verdict", async () => {
    renderPanel();
    const choice = await screen.findByRole("radio", { name: /leans: stricter firearms regulation/i });
    fireEvent.click(choice);

    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ opinions: { guns: 4 } });
    expect(screen.getByText("aligned")).toBeTruthy();
  });

  it("hydrates a saved selection from localStorage", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 1, state: null, opinions: { guns: 5 }, importance: {} }));
    renderPanel();

    await waitFor(() => expect(screen.getByRole("radio", { name: /strongly: stricter firearms regulation/i }).getAttribute("aria-checked")).toBe("true"));
  });

  it("researches only after clicking and renders sourced quotes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        statements: [{ quote: "A direct statement.", source_url: "https://example.com/statement", publisher: "Example", published_at: "2025-01-01", direction: 1 }],
        via: "llm",
        cached: false,
        model: "grok-4.5",
        retrieved_at: "2026-09-06T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    renderPanel();

    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Research with Grok" }));
    expect((await screen.findByRole("blockquote")).textContent).toContain("A direct statement.");
    expect(fetcher).toHaveBeenCalledWith("/api/ask-align", expect.objectContaining({
      body: JSON.stringify({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "C1" }),
    }));
    expect(screen.getByRole("link", { name: /example\.com/ }).getAttribute("href")).toBe("https://example.com/statement");
  });

  it("shows the unavailable copy when live research cannot answer", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      Response.json({ statements: [], via: "unavailable", cached: false, model: null, retrieved_at: "2026-09-06T00:00:00.000Z" }),
    ));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Research with Grok" }));

    expect(await screen.findByText(/Live research is unavailable/)).toBeTruthy();
  });
});

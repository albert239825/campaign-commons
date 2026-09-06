// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskProgress } from "./ask-progress";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AskProgress", () => {
  it("shows the initial and timed answer stages", () => {
    vi.useFakeTimers();
    render(<AskProgress graphMode={false} />);
    expect(screen.getByText("Composing a read-only query over the filings graph…")).toBeTruthy();

    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.getByText("Running it against the filed records…")).toBeTruthy();

    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Checking the summary against the returned rows…")).toBeTruthy();
  });

  it("uses the graph-specific stage", () => {
    vi.useFakeTimers();
    render(<AskProgress graphMode />);
    act(() => vi.advanceTimersByTime(18_000));
    expect(screen.getByText("Drawing the flows and adding filed spending to the candidates…")).toBeTruthy();
  });

  it("allows a label override", () => {
    vi.useFakeTimers();
    render(<AskProgress graphMode label="Loading more rows…" />);
    expect(screen.getByText("Loading more rows…")).toBeTruthy();
    act(() => vi.advanceTimersByTime(40_000));
    expect(screen.getByText("Loading more rows…")).toBeTruthy();
  });
});

// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "next/navigation";
import { LandingAsk } from "./landing-ask";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

afterEach(cleanup);

describe("LandingAsk", () => {
  const push = vi.fn();
  const race = { race_id: "pa-sen-2024", label: "Pennsylvania · U.S. Senate · 2024" };
  const examples = ["Who funds Winsenate?", "Who paid for the ads about Bob Casey?"];

  beforeEach(() => {
    push.mockReset();
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  });

  it("disables Ask when the input is empty", () => {
    render(<LandingAsk races={[race]} examples={examples} />);
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("navigates with the submitted question", () => {
    render(<LandingAsk races={[race]} examples={examples} />);
    const input = screen.getByRole("textbox", { name: "Ask a money question" });
    fireEvent.change(input, { target: { value: "Who funds Winsenate?" } });
    fireEvent.submit(screen.getByRole("button", { name: "Ask" }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/races/pa-sen-2024/ask?q=Who%20funds%20Winsenate%3F");
  });

  it("fills the input from an example chip", () => {
    render(<LandingAsk races={[race]} examples={examples} />);
    fireEvent.click(screen.getByRole("button", { name: "Who funds Winsenate?" }));
    expect((screen.getByRole("textbox", { name: "Ask a money question" }) as HTMLInputElement).value).toBe("Who funds Winsenate?");
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the scope for one race without a race selector", () => {
    render(<LandingAsk races={[race]} examples={[]} />);
    expect(screen.getByText("Asking about Pennsylvania · U.S. Senate · 2024")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("selects among multiple races before submitting", () => {
    const races = [race, { race_id: "ny-sen-2024", label: "New York · U.S. Senate · 2024" }];
    render(<LandingAsk races={races} examples={[]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Race" }), { target: { value: "ny-sen-2024" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a money question" }), { target: { value: "Who funds this race?" } });
    fireEvent.submit(screen.getByRole("button", { name: "Ask" }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/races/ny-sen-2024/ask?q=Who%20funds%20this%20race%3F");
  });
});

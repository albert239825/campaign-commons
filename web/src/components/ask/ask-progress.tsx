"use client";

import React, { useEffect, useState } from "react";

const STAGES = [
  "Composing a read-only query over the filings graph…",
  "Running it against the filed records…",
];

export function AskProgress({ graphMode, label }: { graphMode: boolean; label?: string }) {
  const [stage, setStage] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (label !== undefined) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const advance = (delay: number, nextStage: number) => {
      timers.push(
        setTimeout(() => {
          setVisible(false);
          setStage(nextStage);
          timers.push(setTimeout(() => setVisible(true), 150));
        }, delay),
      );
    };
    advance(8_000, 1);
    advance(18_000, 2);
    advance(40_000, 3);
    return () => timers.forEach(clearTimeout);
  }, [graphMode, label]);

  const text =
    label ??
    ([...STAGES, graphMode ? "Drawing the flows and adding filed spending to the candidates…" : "Checking the summary against the returned rows…", "Still working — large questions can take up to a minute…"][stage] ??
      STAGES[0]);

  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <div className="h-0.5 w-full overflow-hidden bg-neutral-200" aria-hidden="true">
        <div className="ask-progress-bar h-full w-1/3 bg-neutral-900" />
      </div>
      <p className={`text-xs text-neutral-500 transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0"}`}>{text}</p>
    </div>
  );
}

"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

const SECTIONS = [
  { id: "funding", label: "Funding overview" },
  { id: "stories", label: "Start here" },
  { id: "spenders", label: "Top outside spenders" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

export function RaceSections({ funding, stories, spenders }: Record<Section, ReactNode>) {
  const [selected, setSelected] = useState<Section>("funding");
  const prefix = useId();
  const content = { funding, stories, spenders };

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SECTIONS.length - 1;
    else return;
    event.preventDefault();
    setSelected(SECTIONS[next].id);
    document.getElementById(`${prefix}-${SECTIONS[next].id}-tab`)?.focus();
  }

  return (
    <div className="race-sections">
      <div className="race-section-tabs" role="tablist" aria-label="Race dashboard sections">
        {SECTIONS.map((section, index) => (
          <button key={section.id} type="button" role="tab" id={`${prefix}-${section.id}-tab`}
            aria-controls={`${prefix}-${section.id}-panel`} aria-selected={selected === section.id}
            tabIndex={selected === section.id ? 0 : -1} onClick={() => setSelected(section.id)} onKeyDown={event => navigate(event, index)}>
            {section.label}
          </button>
        ))}
      </div>
      {SECTIONS.map(section => (
        <div key={section.id} className="race-section-panel" role="tabpanel" id={`${prefix}-${section.id}-panel`}
          aria-labelledby={`${prefix}-${section.id}-tab`} hidden={selected !== section.id} tabIndex={0}>
          {content[section.id]}
        </div>
      ))}
    </div>
  );
}

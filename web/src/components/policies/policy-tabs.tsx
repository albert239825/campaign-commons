"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export type PolicyTabItem = { id: string; label: string; stances: number; funders: number; ads: number };

const ROOT_ID = "policies-issues";

function summary(item: PolicyTabItem): string {
  if (item.stances === 0 && item.funders === 0 && item.ads === 0) return "No stance · no funder";
  const parts = [
    `${item.stances} ${item.stances === 1 ? "stance" : "stances"}`,
    `${item.funders} ${item.funders === 1 ? "funder" : "funders"}`,
  ];
  if (item.ads > 0) parts.push(`${item.ads} ${item.ads === 1 ? "ad" : "ads"}`);
  return parts.join(" · ");
}

/**
 * Sidebar tablist over server-rendered issue panels. Every panel is in the static HTML (all ten issues, D-26); the
 * client only toggles `hidden` and mirrors the selected issue into the URL hash, so `#abortion` deep-links.
 */
export function PolicyTabs({ items, defaultId, panels }: { items: PolicyTabItem[]; defaultId: string; panels: Record<string, ReactNode> }) {
  const [selected, setSelected] = useState(defaultId);

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      return items.some((item) => item.id === id) ? id : null;
    };
    const sync = () => setSelected(fromHash() ?? defaultId);
    const initial = fromHash();
    if (initial) {
      setSelected(initial);
      requestAnimationFrame(() => document.getElementById(ROOT_ID)?.scrollIntoView({ block: "start" }));
    }
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [items, defaultId]);

  function select(id: string) {
    setSelected(id);
    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, "", `#${id}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    const top = document.getElementById(ROOT_ID);
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    select(items[next].id);
    document.getElementById(`policies-${items[next].id}-tab`)?.focus();
  }

  const covered = items.filter((item) => item.stances > 0 || item.funders > 0).length;

  return (
    <div className="policies-issues" id={ROOT_ID}>
      <nav className="policies-issue-nav" aria-label="Issues">
        <p>
          Issues · {covered} of {items.length} with a stance or a funder
        </p>
        <div role="tablist" aria-orientation="vertical" aria-label="Issues">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`policies-${item.id}-tab`}
              aria-controls={`policies-${item.id}-panel`}
              aria-selected={selected === item.id}
              tabIndex={selected === item.id ? 0 : -1}
              data-covered={item.stances > 0 || item.funders > 0 ? "true" : "false"}
              onClick={() => select(item.id)}
              onKeyDown={(event) => navigate(event, index)}
            >
              <span>{item.label}</span>
              <small>{summary(item)}</small>
            </button>
          ))}
        </div>
      </nav>
      {items.map((item) => (
        <div
          key={item.id}
          className="policies-issue-panel"
          role="tabpanel"
          id={`policies-${item.id}-panel`}
          aria-labelledby={`policies-${item.id}-tab`}
          hidden={selected !== item.id}
          tabIndex={0}
        >
          {panels[item.id]}
        </div>
      ))}
    </div>
  );
}

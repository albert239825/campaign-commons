"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export type IssueTabItem = { id: string; label: string; records: number };

/**
 * Sidebar tablist over server-rendered issue sections. All panels are in the HTML; only `hidden` toggles,
 * so no dossier data is fetched or re-rendered on the client. The selected issue lives in the URL hash.
 */
export function IssueTabs({ items, defaultId, panels }: { items: IssueTabItem[]; defaultId: string; panels: Record<string, ReactNode> }) {
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
      requestAnimationFrame(() => document.getElementById("dossier-issues")?.scrollIntoView({ block: "start" }));
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
    const top = document.getElementById("dossier-issues");
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
    document.getElementById(`${items[next].id}-tab`)?.focus();
  }

  return (
    <div className="dossier-issues" id="dossier-issues">
      <nav className="dossier-issue-nav" aria-label="Issues">
        <p>Issues · {items.filter((item) => item.records > 0).length} of {items.length} on record</p>
        <div role="tablist" aria-orientation="vertical" aria-label="Issues">
          {items.map((item, index) => (
            <button key={item.id} type="button" role="tab" id={`${item.id}-tab`} aria-controls={`${item.id}-panel`}
              aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1}
              data-covered={item.records > 0 ? "true" : "false"}
              onClick={() => select(item.id)} onKeyDown={(event) => navigate(event, index)}>
              <span>{item.label}</span>
              <small>{item.records > 0 ? `${item.records} ${item.records === 1 ? "record" : "records"}` : "No record loaded"}</small>
            </button>
          ))}
        </div>
      </nav>
      {items.map((item) => (
        <div key={item.id} className="dossier-issue-panel" role="tabpanel" id={`${item.id}-panel`} aria-labelledby={`${item.id}-tab`}
          hidden={selected !== item.id} tabIndex={0}>
          {panels[item.id]}
        </div>
      ))}
    </div>
  );
}

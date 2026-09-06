"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchIndex, SearchItem } from "@citizen-gotham/contracts";
import { KIND_LABELS, prepare, search, type Prepared } from "./match";

/** Fetched once per page load on first focus and shared by every box instance. */
let indexCache: Promise<Prepared[]> | null = null;

function loadIndex(): Promise<Prepared[]> {
  if (!indexCache) {
    indexCache = fetch("/search.json")
      .then((r) => {
        if (!r.ok) throw new Error(`search.json ${r.status}`);
        return r.json() as Promise<SearchIndex>;
      })
      .then((idx) => prepare(idx.items))
      .catch((err: unknown) => {
        indexCache = null;
        throw err;
      });
  }
  return indexCache;
}

type Status = "idle" | "loading" | "ready" | "error";

export function SearchBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [prepared, setPrepared] = useState<Prepared[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const ensureIndex = useCallback(() => {
    if (prepared || status === "loading") return;
    setStatus("loading");
    loadIndex().then(
      (p) => {
        setPrepared(p);
        setStatus("ready");
      },
      () => setStatus("error"),
    );
  }, [prepared, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => (prepared ? search(prepared, query) : []), [prepared, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const trimmed = query.trim();
  const showList = open && trimmed.length > 0;
  const activeItem: SearchItem | undefined = flat[Math.min(active, flat.length - 1)];
  const optionId = (item: SearchItem) => `${listId}-${item.kind}-${item.id}`;

  const go = (item: SearchItem) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (showList && activeItem) {
        e.preventDefault();
        go(activeItem);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="relative -my-1">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search races, candidates, committees, donors"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeItem ? optionId(activeItem) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search"
        value={query}
        onFocus={() => {
          ensureIndex();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-[4.5rem] rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-900 transition-[width] placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none sm:w-56 sm:focus:w-64"
      />
      {query === "" && (
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 font-sans text-[11px] text-neutral-400 sm:inline">
          ⌘K
        </kbd>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute right-0 z-20 mt-1 max-h-[70vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg"
        >
          {status === "loading" && <li className="px-3 py-2 text-neutral-500">Loading index…</li>}
          {status === "error" && <li className="px-3 py-2 text-neutral-500">Search index unavailable.</li>}
          {status === "ready" && flat.length === 0 && (
            <li className="px-3 py-2 text-neutral-500">
              No match for “{trimmed}”. Try a last name, committee name, or FEC ID (C0…).
            </li>
          )}
          {groups.map((g) => (
            <li key={g.kind} role="presentation">
              <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                {KIND_LABELS[g.kind]}
              </div>
              <ul role="group" aria-label={KIND_LABELS[g.kind]}>
                {g.items.map((item) => {
                  const isActive = activeItem === item;
                  return (
                    <li
                      key={optionId(item)}
                      id={optionId(item)}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(flat.indexOf(item))}
                      onClick={() => go(item)}
                      className={`cursor-pointer px-3 py-1.5 ${isActive ? "bg-neutral-100 text-neutral-900" : "text-neutral-800"}`}
                    >
                      <div className="truncate">{item.label}</div>
                      {item.sublabel && <div className="truncate text-xs text-neutral-500">{item.sublabel}</div>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

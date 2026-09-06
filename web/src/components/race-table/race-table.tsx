"use client";

import { useEffect, useRef, useState } from "react";
import type { RaceSummary } from "@campaign-commons/contracts";
import { EmptyRow, Table, Th } from "@/components/ui/table";
import { RaceRow } from "./race-row";

const PAGE_SIZE = 5;

export function RaceTable({ races }: { races: RaceSummary[] }) {
  const [page, setPage] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const pageCount = Math.ceil(races.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const shown = races.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    const rows = Array.from(container.current?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !("IntersectionObserver" in window)) return;

    const revealAll = () => {
      rows.forEach((row) => row.removeAttribute("data-reveal"));
      observer.disconnect();
    };
    const observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry, index) => {
        const row = entry.target as HTMLTableRowElement;
        row.style.setProperty("--race-reveal-delay", `${index * 100}ms`);
        row.dataset.reveal = "visible";
        observer.unobserve(row);
      });
    }, { threshold: 0.1 });

    rows.forEach((row) => {
      row.dataset.reveal = "pending";
      observer.observe(row);
    });
    // Changing the OS preference also immediately exposes any pending rows.
    motion.addEventListener("change", revealAll);
    return () => {
      revealAll();
      motion.removeEventListener("change", revealAll);
    };
  }, [currentPage, races]);

  function changePage(next: number) {
    setPage(next);
    container.current?.scrollIntoView({ block: "start" });
    summary.current?.focus({ preventScroll: true });
  }

  return (
    <div className="race-table-container" ref={container}>
      <Table className="race-list-table">
        <thead>
          <tr>
            <Th>Race</Th>
            <Th>Candidates</Th>
            <Th align="right">Campaign</Th>
            <Th align="right">Outside</Th>
            <Th>Outside share</Th>
            <Th align="right">Traceability</Th>
            <Th align="right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {shown.length > 0 ? shown.map((race) => <RaceRow key={race.race_id} race={race} />) : (
            <EmptyRow colSpan={7}>No races available yet.</EmptyRow>
          )}
        </tbody>
      </Table>
      {pageCount > 1 && (
        <nav className="race-pagination" aria-label="Race pages">
          <p ref={summary} tabIndex={-1} role="status" aria-live="polite">
            Races {start + 1}–{start + shown.length} of {races.length} · Page {currentPage + 1} of {pageCount}
          </p>
          <div className="race-pagination-controls">
            <button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>
              <span aria-hidden="true">← </span>Previous
            </button>
            <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => changePage(currentPage + 1)}>
              Next<span aria-hidden="true"> →</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

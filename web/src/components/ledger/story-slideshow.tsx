"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Card } from "@/components/ui";

const STORIES_PER_PAGE = 3;

export function StorySlideshow({ slides }: { slides: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const [grid, setGrid] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const pages = Array.from({ length: Math.ceil(slides.length / STORIES_PER_PAGE) }, (_, index) =>
    slides.slice(index * STORIES_PER_PAGE, (index + 1) * STORIES_PER_PAGE));
  const last = pages.length - 1;
  if (slides.length === 0) return null;

  function goTo(index: number) {
    const element = track.current;
    if (!element) return;
    const page = element.children[Math.max(0, Math.min(last, index))];
    if (!page) return;
    element.scrollTo({
      left: element.scrollLeft + page.getBoundingClientRect().left - element.getBoundingClientRect().left,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  function changeView() {
    // Return to the first group when switching layouts, so the position is predictable.
    setActive(0);
    setGrid(!grid);
    track.current?.scrollTo({ left: 0, behavior: "instant" });
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (grid || event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") goTo(active + 1);
    else if (event.key === "ArrowLeft") goTo(active - 1);
    else if (event.key === "Home") goTo(0);
    else if (event.key === "End") goTo(last);
    else return;
    event.preventDefault();
  }

  return (
    <Card title="Funding highlights" action={
      <button type="button" className="story-change-view" aria-controls={id} onClick={changeView}>
        Change view · {grid ? "Slideshow" : "All stories"} ↔
      </button>
    }>
      <section className="story-slideshow" aria-label="Funding highlights" aria-roledescription={grid ? undefined : "carousel"}>
        <div className="story-slideshow-controls">
          <p role="status" aria-live="polite">{grid ? `All ${slides.length} stories` : `Stories ${active * STORIES_PER_PAGE + 1}–${Math.min((active + 1) * STORIES_PER_PAGE, slides.length)} of ${slides.length}`}</p>
          {!grid && <div>
            <button type="button" aria-label="Previous three stories" aria-controls={id} disabled={active === 0} onClick={() => goTo(active - 1)}>← Previous</button>
            <button type="button" aria-label="Next three stories" aria-controls={id} disabled={active === last} onClick={() => goTo(active + 1)}>Next →</button>
          </div>}
        </div>
        <div id={id} ref={track} className="story-slideshow-track" data-view={grid ? "grid" : "slideshow"} tabIndex={grid ? undefined : 0}
          aria-label={grid ? "All funding stories" : "Stories. Swipe or use left and right arrow keys to navigate."} onKeyDown={navigate}
          onScroll={event => {
            const element = event.currentTarget;
            const bounds = element.getBoundingClientRect();
            if (grid || bounds.width === 0) return;
            // Use actual page positions so the gap between groups is included.
            let nearest = 0;
            let distance = Infinity;
            Array.from(element.children).forEach((page, index) => {
              const offset = Math.abs(page.getBoundingClientRect().left - bounds.left);
              if (offset < distance) {
                nearest = index;
                distance = offset;
              }
            });
            setActive(nearest);
          }}>
          {pages.map((page, index) => (
            <div key={index} className="story-page" role="group" aria-roledescription={grid ? undefined : "slide"}
              aria-label={`Stories ${index * STORIES_PER_PAGE + 1}–${Math.min((index + 1) * STORIES_PER_PAGE, slides.length)}`}
              aria-hidden={!grid && index !== active} inert={!grid && index !== active}>
              {page.map((slide, offset) => <div key={offset} className="story-slide">{slide}</div>)}
            </div>
          ))}
        </div>
        {!grid && <p className="story-slideshow-hint">Swipe, scroll horizontally, or use the arrows to explore three stories at a time.</p>}
      </section>
    </Card>
  );
}

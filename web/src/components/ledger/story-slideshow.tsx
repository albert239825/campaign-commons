"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function StorySlideshow({ slides }: { slides: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const last = slides.length - 1;
  if (slides.length === 0) return null;

  function goTo(index: number) {
    const element = track.current;
    if (!element) return;
    element.scrollTo({
      left: Math.max(0, Math.min(last, index)) * element.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") goTo(active + 1);
    else if (event.key === "ArrowLeft") goTo(active - 1);
    else if (event.key === "Home") goTo(0);
    else if (event.key === "End") goTo(last);
    else return;
    event.preventDefault();
  }

  return (
    <section className="story-slideshow" aria-label="Funding highlights" aria-roledescription="carousel">
      <div className="story-slideshow-controls">
        <p role="status" aria-live="polite">Story {active + 1} of {slides.length}</p>
        <div>
          <button type="button" aria-label="Previous story" aria-controls={id} disabled={active === 0} onClick={() => goTo(active - 1)}>← Previous</button>
          <button type="button" aria-label="Next story" aria-controls={id} disabled={active === last} onClick={() => goTo(active + 1)}>Next →</button>
        </div>
      </div>
      <div id={id} ref={track} className="story-slideshow-track" tabIndex={0}
        aria-label="Stories. Swipe or use left and right arrow keys to navigate." onKeyDown={navigate}
        onScroll={event => {
          const element = event.currentTarget;
          if (element.clientWidth > 0) setActive(Math.max(0, Math.min(last, Math.round(element.scrollLeft / element.clientWidth))));
        }}>
        {slides.map((slide, index) => (
          <div key={index} className="story-slide" role="group" aria-roledescription="slide"
            aria-label={`${index + 1} of ${slides.length}`} aria-hidden={index !== active} inert={index !== active}>
            {slide}
          </div>
        ))}
      </div>
      <p className="story-slideshow-hint">Swipe, scroll horizontally, or use the arrows to explore each story.</p>
    </section>
  );
}

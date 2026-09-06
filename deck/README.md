# Pitch deck (DNHacks 2026)

reveal.js deck (8 slides: cover · ad · questions · today → Campaign Commons · demo · architecture · next · closer) styled with the web app's tokens (`web/src/app/globals.css`: paper `#f2efeb`, ink `#1b1b1a`, tan `#b7ab98`, red `#a53131`, visibility colours; Scto Grotesk A + Cinzel from `web/public/fonts`).

Run from the repo root so fonts/images resolve: `python3 -m http.server 8765` → http://localhost:8765/deck/ . Arrow keys to navigate, `?` for shortcuts, `F` fullscreen. Slide numbers in the corner follow the talk-track outline (docs: `deliverables/campaign-commons-pitch.md` in the session, to be added here once approved).

PDF: `deck/campaign-commons-deck.pdf` (one page per slide, 3200×1800). Rebuild with `./deck/build-pdf.sh` while the http server is running; `?static` in the URL swaps the YouTube embed for a poster still.

Laptop variant: `deck/laptop.html` (same slides + `laptop.css` on top of the theme — larger type, 3×2 / 2×2 layouts) for presenting from a 13–15" screen; PDF at `deck/campaign-commons-deck-laptop.pdf` (`./deck/build-pdf.sh laptop`).

In-app copy: `web/public/deck/` is the laptop deck with asset paths rewritten to `/fonts` and `/images`, linked from the site nav as "Slides" (`/deck/index.html`) with an "Exit to app" link back to `/`. After editing `deck/`, re-copy: `sed 's#\.\./web/public/#/#g' deck/laptop.html > web/public/deck/index.html` (same for `theme.css`; copy `laptop.css`, `ad-poster.jpg` as-is, keep the `.exit` block).

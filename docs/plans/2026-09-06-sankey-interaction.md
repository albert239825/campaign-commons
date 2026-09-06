# Sankey / funding-chain interaction — the short version

Block 3, child H. Docs only. Child C owns `web/src/components/chain/*` today (root highlight, label fit, ad placement, edge table, hover); this covers how a reader *moves through* the graph. Full proposals, measurements, the borrow/don't-borrow matrix and the constraint check are in `2026-09-06-sankey-interaction-appendix.md` (cited as §x below). Screenshots: `docs/design/sankey-interaction/`.

## TL;DR

1. **One session (H1) gets most of the value**: a `viewBox` camera (zoom/pan/fit), a keyboard graph cursor, hover-to-light-the-path, a hop rail, and a shareable URL. No library. Start it as soon as C merges.
2. Everything else (focus/re-root, filters, search, story mode, mobile, compare) rides on H1 and can be picked later, one session each.
3. Four product calls needed from Albert (bottom).

## What is actually wrong today (measured on `main`, 1440 px)

| | |
| --- | --- |
| Whole graph squeezed to width | WINSENATE labels render at **6.4 px** (25 of 47 truncated); SLF 7.5 px; mobile **4.9 px** with a horizontal scrollbar as the only navigation |
| No way to move | no zoom, no pan, no fit; `+` adds a column and shrinks everything further without moving the eye |
| No sense of place | hop labels sit at the bottom of the SVG and scroll away |
| Selection is a border | clicking FUND FOR POLICY REFORM does not light its route to WINSENATE; the panel opens ~500 px below the picture |
| Nothing is shareable | opened/hidden/selected state is `useState` only |
| Three layers, one switch | money ribbons, placement spines and targeting arrows cannot be shown separately |

Screenshots 01–05 in `docs/design/sankey-interaction/` show each. The two biggest chains are the ones people will look at.

## The five highest-value moves (ranked)

| # | Move | Why it matters | Cost |
| --- | --- | --- | --- |
| 1 | **Camera** — write `{x,y,w,h}` to the existing `<svg viewBox>`; toolbar `[+] [−] [fit] [1:1]`; `Ctrl/⌘`+wheel and pinch zoom; drag to pan; plain wheel keeps scrolling the page (§3.1) | Fixes the 6 px problem with one keystroke; layout stays server-rendered (D-24); measured crisp at 2.5× and 60 fps on WINSENATE (§5.2) | 0.7 |
| 2 | **Path highlight** — hover/select a node → light every edge between it and the root, dim the rest to 25 %; targeting arrows stay arrows, copy stays per-edge (§3.4) | Answers "how does this dollar-bearing record reach the spender" without tracing a 6 px ribbon by eye; BFS over edges already in the wire | 0.4 |
| 3 | **Graph cursor + live region** — one tab stop, arrow keys walk edges/siblings, `Enter` opens the panel; announcements in records language (§3.0) | Replaces 59 tab stops; the a11y backbone every later feature reuses | 0.4 |
| 4 | **Hop rail** — sticky `HOP 3 · HOP 2 · HOP 1 · SPENDER · VENDORS · ADS · TARGETED` with counts; click pans to that column (§3.2) | The breadcrumb for a layered graph; primary navigation on mobile later | 0.3 |
| 5 | **URL state** — `?sel=&cam=&open=&hide=&fold=` via debounced `replaceState`; "Copy link to this view" (§3.10) | Makes a view shareable and lets the donor index / compare deep-link later; client-only, no fetch | 0.3 |

Together = **H1, ~2 sessions**, all inside `chain/` in new files (`camera.ts`, `graph-nav.ts`, `url-state.ts`) plus wire-up in `chain-diagram.tsx`. Success criteria: WINSENATE labels ≥ 11 px after one keystroke; plain wheel still scrolls the page; whole graph operable by keyboard with a screen reader; hovering FUND FOR POLICY REFORM lights exactly FFPR → Democracy PAC → SMP → WINSENATE; a pasted URL reproduces zoom + selection.

## Later, one session each (details in appendix)

- **H2 Focus, filters, search** (§3.3, 3.5, 3.7): click a node → open its sources one level and fold siblings; "Focus on this node" re-roots in place via an additive `GraphControls.focus`; legend chips dim by `disclosed/inferable/unwalked/dark` (dim, not remove, so ribbons still sum) and toggle `money/placement/targeting` layers independently; `/` search over all 461 wire nodes incl. folded ones. ~1.5 sessions.
- **H3 Story mode + mobile** (§3.6, 3.9): six-card guided walk from an ad back to the money, each sentence sourced; on phones default to the spender at k≈1, segmented hop rail, bottom-sheet panel. ~1.3 sessions.
- **H4 Compare / donor index** (§3.8): not two synced Sankeys — either curated prebuilt compare pages or a `funders-index.json` giving "appears in N chains" on entity pages. ~1 session, additive pipeline output.

## Constraints (all proposals checked in appendix §4)

Every number comes from `record`/`basis`/`amount_in` already in the wire — no path sums, no runtime fetch. Money ribbons and targeting arrows never share a grammar in any state. Copy stays "received from / paid to / aimed at". `unwalked` stays distinct from `dark`. Hand-rolled SVG stays: `d3-zoom` (16 KB gz) is not needed for these gestures and hijacks page scroll by default; `d3-sankey` still rejected (D-24, C-46).

## Decisions needed from Albert

1. **Wheel**: plain wheel scrolls the page, zoom needs `Ctrl/⌘` or the toolbar (Google-Maps-embed behaviour) — OK?
2. **Filters**: dim (ribbons keep summing to receipts) for disclosure, remove for edge-kind layers — OK?
3. **Order after H1**: H2 (focus/filters/search) or H3 (story mode + mobile) next?
4. **Compare**: curated side-by-side pairs (A) or donor → every chain it appears in (B)? Lean: B first.

Remaining smaller calls (accordion default, re-root in place vs navigate, `hide=` in shared URLs, semantic zoom) are in appendix §7 and can be decided when H2 starts.

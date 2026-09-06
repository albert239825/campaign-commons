# Sankey / funding-chain interaction spec — zoom, navigation, exploration

Block 3, child H (the plan in `2026-09-06-block3.md` calls this slot "child G / G6"). Docs only. Decision-ready: §6 ranks the follow-up sessions; §7 lists the product calls needed.

Scope split: child C owns G1–G5 (root highlight, label fit, misc-ads placement, edge table collapsed + click-edge→row, hover tooltips) and everything under `web/src/components/chain/*` right now. This document covers the rest: how a reader *moves through* the graph. Nothing here should be built until C merges (§6 dependencies).

Evidence for §1 comes from running the app at `b2bd6b5` (main, 2026-09-06) and measuring the rendered SVG with a throwaway Playwright script; the script is not committed. Screenshots live in `docs/design/sankey-interaction/` (the repo keeps images under `docs/design/`, so that convention is followed instead of creating `docs/img/`).

---

## 1. Current state

### 1.1 What the graph shows

One spender (the **root**) in the middle; money **into** it on the left, what it **did with it** on the right.

| Side | Nodes (`ViewNode.kind`) | Edges (`ViewEdge.kind`) | Visual grammar |
| --- | --- | --- | --- |
| in (funding) | `committee`, `individual`, `organization`, synthetic `aggregate` ("Other contributors to X") | `money` — transfers/contributions, Schedule A/B | filled ribbon, width ∝ dollars, colour = `visibility` (disclosed green / inferable amber / unwalked grey / dark red-hatched) |
| root | the spender | — | box with heavier border |
| out (spending) | `vendor`, `ad`, `candidate`, `aggregate` ("N more ads") | `money` (root→vendor, Schedule E), `placement` (vendor→ad or root→ad), `targeting` (ad/root→candidate) | money = ribbon; placement = thin spine, solid = filed/verified, dashed = inferred; targeting = thin arrow — **no dollars reach the candidate** |

Columns are by hop (`depth`) and side: `HOP 3 · HOP 2 · HOP 1 · SPENDER · PAID VENDORS · ADS · TARGETED`. Ad and aggregate nodes on the out side are fixed 58 px tall so that estimated ad spend is never read as a money quantity (C-46). Out-side nodes carry a `visibility` field that means little there (C-59); only funding-side visibility is a disclosure category.

### 1.2 Wire format (`view.ts`)

The page server-renders the full SVG (D-24, D-40) and ships the whole chain as a compact tuple wire so the client can re-prune without a fetch:

```
ChainViewWire = [rootId, rootName, ViewNodeWire[], ViewEdgeWire[]]
ViewNodeWire  = [id, name, kind, committee_type, depth, visibility, amount_in, terminus_reason,
                 organization_class, href, side, record, basis, medium, thumbnail]
ViewEdgeWire  = [fromIdx, toIdx, amount, visibility, count, kind|null(=money), basis, support_oppose]
```

Every node keeps `href` (its page) and `record` (FEC/Google record URL); every non-money edge keeps a `basis = [kind, rule, source_urls[]]`. Anything proposed below that shows a number must come from these fields or from an *additive* new tuple slot — never from a runtime fetch.

### 1.3 Pruning (`visibleGraph`) and controls

- Always drawn: root, its direct sources, every funding node with `amount_in ≥ 2 %` of the root's receipts (`MATERIAL_SHARE`), capped at 40 (`MAX_MATERIAL_NODES`).
- Smaller sources fold into a dashed `aggregate` node per parent ("Other contributors to X").
- `GraphControls = { opened, collapsed, hidden }` — three `Set<string>` of node ids. `opened` shows *all* sources of one node (the `+` handle); `collapsed` folds an out-side node's children (`−`); `hidden` removes a node and its edges (panel button). Node state is `leaf | closed | partial | full`.
- Out side: top 10 ads by estimated spend, the rest in one "N more ads" aggregate; all vendors and candidates.

### 1.4 Node panel and page

Clicking a node (or Enter/Space on it — every node is `role="button" tabIndex=0`) opens `NodePanel` **below** the SVG: kind, amount, visibility, `organization_class`, incident edges with basis + source links, and three actions (`+`/`−` toggle, "Hide from picture", "Open full page →", "FEC record ↗"). The SVG has `viewBox` + `width="100%"`, sits in `.chain-map-scroll { overflow-x: auto }` with `min-width: 1000px`, and is capped at `max-height: 880px`. The complete edge table renders under the assumptions text. The ad page (`/ads/<ad_id>`) reuses the same component on `adFocusWire`: the sponsor's whole funding side, only the vendors with a verified/inferred link to that ad, the ad, and its targeting edges (D-72, D-74).

### 1.5 Measured today (1440 × 900 viewport, Chrome)

| Chain | nodes in file | labelled boxes drawn (both sides) | viewBox | render scale | label px (11 pt) | truncated labels |
| --- | --- | --- | --- | --- | --- | --- |
| WINSENATE `C00865444` | 481 / 487 edges | 47 (27 funding + 20 spending) | 2250 × 852 | 0.58 | **6.4 px** | 25 / 47 |
| Senate Leadership Fund `C00571703` | 47 | 43 (27 direct sources) | 1910 × 1287 | 0.68 (height-capped) | 7.5 px | 12 / 43 |
| For Our Future `C00620971` | 675, 7 hops | 45 (8 funding + 36 spending) | 1570 × 1560 | 0.83 | 9.1 px | 4 / 45 |
| Bitcoin Voter PAC `C00880518` | 5 | 5 | 1230 × 418 | 1.06 | 11.7 px | 0 |
| WINSENATE at 390 px (mobile) | — | — | same | 0.44 | **4.9 px**; 1000 px wide, 327 px viewport | — |

Median chain is 27 nodes; 12 chains exceed 600 nodes. WINSENATE's hydrated DOM serialises to 1.26 MB in dev (C-58 measured the production HTML at 708 KB). The SVG has 515 elements, 75 paths, 131 `<text>`; `getComputedTextLength` over all 47 labels takes 0.6 ms; re-setting `viewBox` 60× in a `requestAnimationFrame` loop costs 16.3 ms/frame (i.e. 60 fps with headroom).

### 1.6 What is awkward today (beyond C's five)

1. **The whole graph is squeezed to fit the width.** Text is 6–8 px on the two biggest chains; the only recovery is browser zoom, which zooms the page, not the map. On mobile it is 4.9 px with a horizontal scrollbar as the sole navigation.
2. **Expanding does not move the eye.** `+` adds a column on the far left and the scale shrinks further; nothing scrolls or centres on what was opened (screenshot 03).
3. **No sense of place.** The hop labels sit at the bottom of the SVG and scroll away; there is no indication of which part of a 2250-unit-wide picture the viewport shows.
4. **Selection is a border.** Selecting FUND FOR POLICY REFORM does not light its route to WINSENATE or dim the rest; the reader has to trace a 6 px ribbon by eye (screenshot 04).
5. **Detail is far from the picture.** The panel renders ~500 px below the graph; the eye leaves the map to read, and comes back with no highlight to return to.
6. **"Re-root" is a page navigation.** The only way to look at a node's own world is "Open full page", which loses the context you came from. Only the 86 spenders have chains at all; a funder's page is an entity page, not a chain.
7. **The fold hides the answer.** On SLF the biggest node is the $69M "Other contributors" aggregate; on WINSENATE 34 sources ($50M) are folded. There is no way to ask "which of the folded ones are dark?" without the table.
8. **Three visual layers, one switch.** Money ribbons, placement spines and targeting arrows share the picture; a reader who only wants the money has no way to quiet the rest, and vice-versa.
9. **Nothing is shareable.** Opened/hidden/selected state lives in `useState`; a URL always shows the default picture.

### 1.7 Screenshots (annotated)

| # | File | Shows |
| --- | --- | --- |
| 01 | `../design/sankey-interaction/01-winsenate-fit-to-width.png` | WINSENATE: 6.4 px labels; SMP is WINSENATE's only source ($312.85M of SMP's $329M), so root and hop 1 are two near-identical boxes; "64 more ads" as the only handle on 74 ads; targeting arrows read as thin money at this scale; five `+` handles are the whole expansion UI |
| 02 | `../design/sankey-interaction/02-slf-tall-column.png` | SLF: 27 direct sources make a column-list; largest node is the fold; vendors squeezed to 30 px so ten fixed-height ads fit; the candidate hangs off the ads with no visible path back to the money |
| 03 | `../design/sankey-interaction/03-for-our-future-vendor-wall.png` | For Our Future: 3 of 7 hops drawn; 35 vendor rows at 1 row each with ≤1 px ribbons; 35 targeting arrows converge on one candidate |
| 04 | `../design/sankey-interaction/04-node-panel-below-graph.png` | Node selected: border only, no lit path; panel far below; "Open full page" is the only re-root |
| 05 | `../design/sankey-interaction/05-mobile-horizontal-scroll.png` | 390 px: 4.9 px labels, horizontal scrollbar only |
| proto | `../design/sankey-interaction/proto-viewbox-zoom.png`, `proto-css-wrapper-zoom.png` | §5.2 feasibility: 2.5× zoom via `viewBox` and via CSS transform — both crisp |

---

## 2. Jobs to be done

Each is phrased as the reader would, with the CRITIQUE finding that motivates it and the data field that answers it.

| # | Reader's question | Grounding | Data already in the wire |
| --- | --- | --- | --- |
| J1 | "Where did WINSENATE's money come from, and how much of it is dark?" | C-10 (why the picture is pruned at all); C-30/C-31 (dark-wall classification is the headline claim and its riskiest inference, so the UI must make *which* nodes are dark inspectable) | funding-side `visibility`, `amount_in`, `organization_class`, the share bar |
| J2 | "Who is the *top* of this chain — who is behind the biggest ribbon, all the way up?" | C-30/C-31 (what a terminus *is* is the riskiest claim); C-37 (depth-cap nodes are `unwalked`, not dark, but their in-edges are still drawn green); LOG Block 2 ("past the first hop the amount is a pooled total" — the walk must not imply a dollar travelled) | `depth`, `terminus_reason`, ancestor walk over `edges` |
| J3 | "Which ads did this money pay for, and who placed them?" | D-61/D-72/D-74 — placement is evidence-graded, never implied by timing | out-side `placement` edges + `basis`; `thumbnail`, `medium` |
| J4 | "Whom was it aimed at — for or against — and is that money to the candidate?" (answer: never) | README rule; D-61; C-46 | `targeting` edges, `support_oppose` |
| J5 | "I'm on an ad. How do I get back to the money that paid for it?" | D-72 (per-ad pages exist for this), the Sep 5 critique ("no navigation") | `adFocusWire` already re-roots; needs a *walk*, not a picture |
| J6 | "What else did this donor fund?" | ONTOLOGY §4 (edges are records; a donor is a node in many chains); D-43 (evidence links are pair-filtered to sender/receiver, so a cross-chain row must carry *that* pair's record); LOG Block 2 donor pages already do a forward walk in prose | `href` to the entity page today; cross-chain needs an additive index (§3.8) |
| J7 | "Is this the same picture as last time / can I send you what I'm looking at?" | not in CRITIQUE yet — falls out of the Sep 5 "no navigation" finding; every opened/hidden/selected state today is `useState` only | none — URL state (§3.10) |
| J8 | "Which of these smaller, folded sources matter — are any of them dark?" | D-40 fold rules; C-31 | folded nodes are in the wire; only the UI hides them |

---

## 3. Interaction proposals

Conventions used below: **k** = render scale (viewBox units → CSS px); "session" = one Devin session of my throughput, including tests and a11y pass; every proposal lists the additive wire field it needs, or "none".

### 3.0 Graph cursor (keyboard backbone — prerequisite for everything else)

**What.** One tab stop for the whole map instead of one per node (59 on WINSENATE today). Inside the map, arrow keys move a *cursor* along edges: `←` to the largest upstream source, `→` to the largest downstream node, `↑`/`↓` to the previous/next sibling in the same column (sorted as drawn), `Home` to the root, `Enter` opens the panel, `Esc` clears. A visually-hidden `aria-live="polite"` region announces the node in plain records language: *"Democracy PAC, super PAC, $71M into SMP, disclosed; 3 sources drawn, 4 folded."*

```
  [HOP 2]        [HOP 1]        [SPENDER]
  ┌──────────┐   ┌──────────┐   ┏━━━━━━━━━━┓
  │ DEM. PAC │ ← │   SMP    │ ← ┃ WINSENATE┃ →  vendors…
  └──────────┘   └──────────┘   ┗━━━━━━━━━━┛
     ↑↓ siblings     cursor: focus ring + panel; ← → follow edges
```

**Data.** none. **A11y.** WAI-ARIA `grid`-like roving `tabIndex` (`aria-activedescendant` on the map region); native `<title>` stays for pointer users; `prefers-reduced-motion` suppresses the camera follow. **Cost.** 0.3 session (built inside 3.1's session).

### 3.1 Zoom & pan: a viewBox camera

**What.** The layout stays server-rendered and untouched (D-24). A tiny client `camera = {x, y, w, h}` is written to the existing `<svg viewBox>`; nothing else re-renders. Controls:

| Input | Behaviour |
| --- | --- |
| plain wheel / trackpad scroll | **page scrolls** (never hijacked — the embedded-map convention; d3-zoom's default is the opposite) |
| `Ctrl`/`⌘` + wheel, trackpad pinch (arrives as ctrl-wheel), two-finger pinch on touch | zoom about the pointer, k ∈ [fit, k_max] |
| drag on empty canvas, one-finger drag on touch | pan; `cursor: grab` |
| double-click empty canvas | zoom 2× about the point |
| toolbar `[+] [−] [⤢ fit] [1:1]` | step zoom ×1.5, fit whole graph, k = 1 (labels at their designed 11 px) |
| keyboard (map focused) | `+`/`−` zoom, `0` fit, `Shift+arrows` pan, `f` fit to cursor node and its neighbours |
| camera follow | when the cursor/selection moves off-screen the camera pans (not zooms) to bring it in; expanding a node (`+`) fits its new column |

k_max = the scale at which 11-pt labels render at 18 px (≈ 3.1× on WINSENATE at 1440). Below k ≈ 0.7 a **semantic-zoom** rule hides amount/sub-labels on boxes shorter than 20 px instead of drawing 4 px text (a `data-k` attribute on the SVG + CSS, no re-layout).

```
 ┌─ toolbar ──────────────────────────────────────────────┐
 │ [+] [−] [⤢ fit] [1:1]        HOP3 · HOP2 · HOP1 · [SPENDER] · VENDORS · ADS · TARGETED │
 ├────────────────────────────────────────────────────────┤
 │                     ╭───────╮                           │
 │  ═══════════════════╡  SMP  ╞════╗  ┏━━━━━━━━━━━┓       │
 │     ═════════════════╰───────╯    ╚══┃ WINSENATE ┃══     │ ← viewBox = camera
 │  ───────────                         ┗━━━━━━━━━━━┛       │
 │                                          ┌────┐          │
 │                                   minimap│▓▓  │ (3.2)    │
 └──────────────────────────────────────────└────┘──────────┘
```

**Feasibility (measured, §5.2).** viewBox zoom at 2.5× gives 15.9 px labels, crisp, clipped by the SVG's own box; a CSS `transform: scale()` on the inner `<g>` is equally crisp but a CSS transform on the HTML wrapper spills over the caption and needs `overflow: hidden` + hit-test care, so **use viewBox**. 60 viewBox writes/s cost 16 ms/frame on WINSENATE.

**Data.** none. **A11y.** All pointer gestures have a keyboard twin above and a visible toolbar; zoom level is announced ("zoom 2×, showing hop 1 to vendors"); focus ring drawn in screen-px (`vector-effect: non-scaling-stroke`) so it does not fatten with k. Touch targets ≥ 24 px at any k by inflating hit rects, not visuals. **Cost.** 0.7 session including tests for the camera math (pure functions in a new `chain/camera.ts`).

### 3.2 Sense of place: hop rail + minimap

**What.** Two things, cheap because the layout is columnar:

1. **Hop rail** — the existing bottom column labels move up into a sticky HTML row above the map (`HOP 3 · HOP 2 · HOP 1 · SPENDER · VENDORS · ADS · TARGETED`), each with a count ("HOP 2 · 13 drawn / 41") and the currently visible columns underlined. Clicking a rail item pans/zooms the camera to that column. This *is* the breadcrumb for a layered graph: "you are looking at hop 2 of 3".
2. **Minimap** — appears only when k > 1.3, bottom-right, 160 × 60 px: one tiny `<rect>` per drawn node (coordinates already in `layoutChain`), no text, viewport rectangle draggable. Hidden at fit because it is redundant there.

```
  HOP 3    HOP 2 ▔▔▔▔  HOP 1 ▔▔▔▔  SPENDER ▔▔▔▔  VENDORS    ADS    TARGETED
  11/47    13/41       1           1             7          10+64  2
```

**Data.** none (counts come from `visibleGraph` + `view.nodes`). **A11y.** Rail items are real buttons ("Go to hop 2"); the minimap is `aria-hidden` (keyboard users have the rail). **Cost.** 0.4 session.

### 3.3 Focus: expand upstream, collapse siblings, re-root in place

**What.** Three related gestures on the funding side:

- **Expand one level up.** Clicking a `closed`/`partial` node (not its `+`) selects it *and* opens its direct sources — one level, not the whole subtree. The `+` keeps today's meaning ("show all of mine"). Camera fits the new column.
- **Accordion (collapse siblings).** Default on: opening node A at hop 1 closes any other hop-1 node that was opened by clicking (not by `+`), so the picture stays one story wide. Toggle in the toolbar for people who want to pin several.
- **Re-root here (in place).** Panel action "Focus on this node" → `GraphControls.focus = id`. `visibleGraph` then draws: the node's ancestors (its own funding tree, material rule applied relative to *its* `amount_in`), the node, and the spine from it down to the root (so the reader never loses where the money went). Everything else is removed (not dimmed — dimming is the hover grammar, §3.4). A crumb appears: `WINSENATE › SMP › Democracy PAC  [× back to whole chain]`. "Open full page →" stays for the 86 nodes that have their own chain.

```
  before                                   after "Focus on Democracy PAC"
  ┌──┐┌──┐┌──┐                             ┌────────┐
  │  ││  ││  │╲                             │FUND FOR│╲
  └──┘└──┘└──┘ ╲┌───────┐                  │POL.REF.│ ╲ ┌───────────┐     ┌────┐   ┏━━━━━━┓
  ┌──┐┌──┐┌──┐──│  SMP  │═┏━━━━┓            └────────┘──│DEMOCRACY  │═════│SMP │═══┃WINSEN┃
  │  ││  ││  │╱ └───────┘ ┃ WS ┃            ┌────────┐╱ │PAC (focus)│     └────┘   ┗━━━━━━┛
  └──┘└──┘└──┘            ┗━━━━┛            │  …3 more│  └───────────┘   (spine kept, dimmed labels)
                                            WINSENATE › SMP › Democracy PAC   [× whole chain]
```

**Data.** none — every ancestor is already in the wire. Additive control: `GraphControls.focus?: string | null`. **A11y.** "Focus on this node" is a panel button; the crumb is a `<nav aria-label="Graph focus">`; `Backspace` in the map pops one crumb. **Cost.** 0.8 session (the `visibleGraph` change needs tests for material-share-relative-to-focus and for the spine).

### 3.4 Path highlighting and dimming

**What.** Hovering or cursoring a node lights every edge and node on any path between it and the root, in both directions; everything else fades to 25 % opacity. On the funding side that is "how this dollar-bearing record reaches the spender"; on the out side, hovering an ad lights the sponsor, its placement spine(s), and its targeting arrow(s) — **each in its own grammar** (ribbon stays a ribbon, arrow stays an arrow; highlight is a stroke/opacity change only, never a fill that could make a targeting arrow look like a money band). Selected (clicked) state pins the highlight until `Esc`.

What the highlight must **not** say: no "X's $60M reached WINSENATE". Money is fungible across an intermediary; the honest readout is per-edge (*"Fund for Policy Reform → Democracy PAC $60M (dark) · Democracy PAC → SMP $71M (disclosed) · SMP → WINSENATE $313M"*), each with its own `source_url`, which is what the panel already shows. The lit path is a reading aid, not a computed flow.

```
  ░░░░░░░░░░ dimmed                  ▓▓▓▓▓▓▓ lit path
  ┌───────┐              ┌────────┐            ┏━━━━━━━━━━┓
  │ FFPR  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓│DEM. PAC│▓▓▓▓▓▓▓▓▓▓▓▓┃ WINSENATE ┃⇢⇢⇢ Dave McCormick   (arrow stays arrow)
  └───────┘              └────────┘            ┗━━━━━━━━━━┛
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

**Data.** none — ancestor/descendant sets are a BFS over `view.edges` (memoised per node; 487 edges is trivial). **A11y.** The cursor drives the same highlight; the live region says how many edges are lit; opacity dimming keeps ≥ 3:1 contrast on the lit path and dimmed text stays ≥ 25 % (decorative — the table is the accessible record). Respect `forced-colors`. Interplay with C's hover tooltips: C shows *the node*; this shows *its route*; both fire on the same event. **Cost.** 0.4 session.

### 3.5 Filters: visibility layers and edge-kind layers

**What.** The legend becomes the control. Each chip is a toggle; two independent groups:

- **Disclosure (funding side only):** `disclosed · inferable · unwalked · dark`. Default all on. Turning one off **dims** (25 %) rather than removes, so ribbon widths into the root still visibly sum to its receipts and nothing appears to "leak". A second click on a chip makes it *solo* ("dark only"). The share bar above the graph becomes clickable with the same effect, so J1 is "click the red segment" (J8: solo `dark` with a folded aggregate open shows which of the small ones are dark).
- **Layers (spending side):** `money · placement · targeting`. Independent checkboxes; off = removed from the picture (they are separate record types, nothing sums across them). When `targeting` is the only layer on, the candidate boxes keep the arrow grammar and the caption says *"independent expenditures for/against; no money reaches the candidate"*. There is deliberately no state in which a targeting edge can be drawn without its arrowhead or with a proportional width.

`unwalked` is kept as its own chip (D-41) — it is not dark, and C-37 notes edges into unwalked nodes may still be `disclosed`; the filter must key off the *node's* visibility for node dimming and the *edge's* for edge dimming, and the caption should say so when they differ.

```
  ● disclosed  ● inferable  ● unwalked  ▨ dark(solo)   |   ☑ money  ☐ placement  ☑ targeting
  ─────────────────────────────────────────────────────────────────────────────────────────
  ░░░░░░░░░░░░░░░░░░░░░ MAJORITY FORWARD ▨▨▨▨▨▨▨▨▨▨▨▨▨ SMP ═══ WINSENATE ⇢ McCormick
  ░░░░░░░░░░░░░░░░░░░░░ ░░░░░░░░░░░░░░░░ ░░░░░░░░░░░░░░░              ░░░░░ (placement off)
```

**Data.** none. **A11y.** Chips are `role="switch"` with `aria-checked`; the group has a legend; live region: "showing dark only: 3 drawn nodes (Majority Forward $82M, Fund for Policy Reform $60M, Greater New York Hospital Association $8.5M); dark share of receipts 34 %" — the share comes from `summary.dark_share`, never from summing drawn ribbons (a dark hop-2 node's dollars pass through a disclosed hop-1 node; summing would double count). Filters are also URL state (§3.10). **Cost.** 0.5 session.

### 3.6 Story mode: walk from an ad back to the money

**What.** On `/ads/<ad_id>` (and as "Walk this chain" on the chain page) a stepper drives the camera + focus + highlight and shows one card per step, each sentence in records language with its `source_url`s. Steps for an ad:

1. **This ad** — thumbnail, dates, medium, est. spend *range* (Google), link to the Transparency record.
2. **Who placed it** — vendor(s) with a verified/inferred link, the `basis` rule and sources; or *"FEC does not record which buy placed this ad"* (then this step shows the sponsor's digital vendors as context text, never as an edge — D-74).
3. **Who paid** — the sponsor, its Schedule E total to those vendors, FEC record.
4. **Where the sponsor's money came from** — direct sources, largest first, disclosure share.
5. **The top of the chain** — the deepest material nodes and their `terminus_reason` (dark wall / individual / unwalked / depth cap), each with its record.
6. **Whom it was aimed at** — candidate, for/against, *"independent expenditure; no money reaches the candidate"*.

`←`/`→` or on-screen buttons move steps; `Esc` exits with the camera left where the story ended. Progress is URL state (`story=4`).

```
  ┌ Step 3 of 6 · Who paid ────────────────────────────────────── ‹ › ✕ ┐
  │ WINSENATE paid GAMBIT STRATEGIES $19.7M (Schedule E, 48 records) ↗   │
  │ Gambit is linked to this ad as the only digital vendor paid in its   │
  │ run window — inferred, not filed ↗                                    │
  └───────────────────────────────────────────────────────────────────────┘
        camera: fit {ad, Gambit, WINSENATE}; everything else dimmed
```

**Data.** none — `adFocusWire` already carries every node/edge/basis used; the sentences are templated from `ViewEdge.kind`, `basis`, `terminus_reason`, `support_oppose`. Optional additive: nothing. **A11y.** Stepper is a `role="region" aria-roledescription="guided walk"`, each card is the live announcement; works without the SVG (the cards alone are a complete, sourced narrative — that is also the mobile fallback, §3.9). **Cost.** 0.8 session after 3.1/3.4 exist.

### 3.7 Search in graph

**What.** A `/`-focusable input above the map searches `view.nodes` by name — including folded and hidden ones (WINSENATE ships 461 funding nodes, draws 47). Results list shows kind, amount, visibility, and whether the node is currently drawn / folded / hidden. Choosing a folded node computes its path to the root, adds the needed parents to `opened`, selects it, lights the path and fits the camera. Hidden nodes get an "unhide" affordance.

```
  🔍 simon________________   3 results
     SIMONS, JAMES          individual  $7.5M  disclosed   drawn
     SIMONS, MARILYN        individual  $4.5M  disclosed   folded under "Other contributors to SMP"
     SIMON, DEBORAH J.      individual  $4.0M  disclosed   folded under "Other contributors to SMP"
```

**Data.** none. Later: an optional per-race `search-index.json` (id, name, kind, chain ids) would let search leave the current chain — that is J6 and belongs with 3.8. **A11y.** `role="combobox"` + listbox; result count announced. **Cost.** 0.4 session.

### 3.8 Compare two chains (and "what else did this donor fund")

**What.** Two honest options, because a second full Sankey on the same page is the wrong tool and 86² pairs cannot be prebuilt without a fetch:

- **A. Side-by-side facts (recommended).** `/races/pa-sen-2024/compare?a=<id>&b=<id>` for a *curated* set of pairs (e.g. the top spender on each side: WINSENATE vs SLF), prebuilt: two share bars, top-8 sources each, **shared sources** (the actual question), and two *thumbnail* graphs (minimap-style rects, no labels) that link to each chain. Shared sources need an additive pipeline output `compare/<a>-<b>.json` with `[node_id, amount_to_a, amount_to_b, visibility]` rows, each row carrying the two `source_url`s.
- **B. Donor-centric.** The reverse of a chain: for a funding node, every chain it appears in with its `amount_in` there. Needs an additive `funders-index.json` (id → `[chain_id, amount, depth][]`) rendered on the entity page as "Appears in N funding chains", each linking to `/chains/<id>?focus=<donor>` (§3.10 makes that link land on the lit path). This answers J6 for *every* donor, not curated pairs.

Not proposed: two synchronised interactive Sankeys. The eye cannot compare two ribbon fields; a table of shared sources with two columns does the job and keeps every number sourced.

**Data.** additive files above, produced by the pipeline (DuckDB), static. **A11y.** Plain tables. **Cost.** A: 1 session (pipeline + page). B: 0.7 session (pipeline + entity-page section + `?focus` deep-link from 3.3/3.10).

### 3.9 Mobile / narrow (< 720 px)

**What.** At 390 px the fit view is 4.9 px text; nothing short of a different default fixes it.

- Default camera = **fit-to-height on the spender column** (k ≈ 1), not fit-to-width; the reader starts at the root at legible size and pans. Hop rail (3.2) becomes a horizontal segmented control that pans column to column — that is the primary navigation on mobile, not free pan.
- Pinch zoom and one-finger pan on the SVG (`touch-action: none` *inside the map only*; the page still scrolls when the finger starts outside it).
- Node panel becomes a bottom sheet over the map instead of a block below it.
- "Walk this chain" (3.6) is offered above the map as the first call to action; the cards are readable without the picture.

```
  ┌──────────────────────┐
  │ HOP2 │ HOP1 │[SPENDER]│ VENDORS │ ADS │▶   ← segmented hop rail, scrolls
  ├──────────────────────┤
  │      ┏━━━━━━━━━━━┓   │
  │  ════┃ WINSENATE ┃══ │  k≈1, pan with a finger
  │      ┗━━━━━━━━━━━┛   │
  ├──────────────────────┤
  │ ▲ WINSENATE · Super PAC · $313M         │  ← bottom sheet
  └──────────────────────┘
```

**Data.** none. **A11y.** Same keyboard model with an external keyboard; sheet is a `dialog` with focus trap only when expanded. **Cost.** 0.5 session on top of 3.1/3.2.

### 3.10 URL state (shareable views)

**What.** Client state → query string, `history.replaceState` debounced 300 ms (never `pushState` on zoom — the back button must not have to undo 40 wheel ticks). Read once after hydration. Static export is unaffected (query strings are client-only).

```
/races/pa-sen-2024/chains/C00865444
   ?focus=C00693382            (3.3 re-root — Democracy PAC)
   &sel=org:FUND_FOR_POLICY_REFORM   (selected/pinned highlight, 3.4)
   &open=C00693382,C00484642   (opened sources)
   &hide=…  &fold=…            (hidden; collapsed out-side)
   &vis=dark                   (solo) or vis=disclosed,inferable
   &layers=money,targeting
   &cam=2.1,640,120            (k, x, y — omitted at fit)
   &story=4
```

Node ids are FEC ids or the pipeline's stable ids (`org:…`, `ind:…|zip`), so links survive rebuilds as long as ids do (they are the same ids the edge table already keys on); the `|` and `:` need URL-encoding, which `URLSearchParams` does. A "Copy link to this view" button next to the toolbar; the same string is what 3.8B's "appears in N chains" links use.

**Data.** none. **A11y.** The button reports "link copied" in the live region. **Cost.** 0.3 session (parsing/serialising with tests; the state itself comes from 3.1–3.5).

### 3.11 Additional ideas (not in the brief)

- **Legend = controls** (folded into 3.5): the only new chrome is the toolbar; the legend and share bar that already exist become interactive.
- **Column-header actions** (with 3.2): right-click / long-press a hop rail item → "fold all in this column", "sort by amount / by disclosure". Sorting by disclosure groups the red hatched ribbons together, which is J1 at a glance without any filter. 0.2 session inside 3.2.
- **Edge → row → edge** (extends C's G4): the edge table row, when hovered, lights the edge in the graph too, so the table becomes a second navigation surface for the graph. 0.1 session once 3.4 exists; must coordinate with C's row-highlight class names.
- **Keyboard "explain this edge"**: with an edge lit, `?` reads its basis sentence aloud via the live region. Free once 3.4 exists.

### 3.12 What to borrow, what not

| Source | Borrow | Do not borrow | Why |
| --- | --- | --- | --- |
| **OpenSecrets** outside-spending profiles | The one-line **disclosure badge** at the top of the page ("Discloses donors? PARTIAL") as a chip that is also the dark filter; breadcrumb `Home › Outside spending › <group>` | "Success rate" / "spent supporting N candidates who won" framing | that framing implies the spend caused the result; README forbids causal language |
| **FollowTheMoney** (Ask Anything, My Legislature, Power Mapping) | **Query as breadcrumb**: every drill-down adds a crumb you can pop — our 3.3 focus crumb and 3.10 URL | "which donors might have the inside track to influence legislation" copy; alignment/power scores | inference presented as fact; we label every inferred edge with `basis` |
| **Observable / d3-sankey** examples (Bostock's energy Sankey; "highlight all connecting paths" forks) | Hover → **traverse both directions and dim the rest** (3.4); link `<title>`s | Draggable nodes; `nodeAlign: justify` (pushes leaves to the far column, which would put a hop-1 dark wall in the hop-3 column); gradient links; d3-zoom's wheel capture (the page stops scrolling once the pointer is over the chart) | our columns *mean* hops; dragging breaks the sourced layout; gradients blur which node's visibility a ribbon carries |
| **Obsidian graph view** | **Local graph with a depth slider** = our focus mode + "expand one level"; hover lights connections; search filters nodes; colour groups by query (= our legend chips) | Force layout; physics sliders; animated settling | direction (left = money in, right = money out) is the whole point; force layouts are also nearly unusable with a keyboard or screen reader |
| **Gephi Lite** | **Search nodes/edges** box; filters panel with live counts; the **data table synced with the graph** selection (our edge table); multitouch pan/zoom on mobile; the caption updates with the filter | Layout/appearance algorithms; sigma.js WebGL renderer | 60 drawn nodes do not need WebGL; every visual encoding here is fixed by the ontology, not user-chosen |

---

## 4. Constraints, and how each proposal meets them

| Constraint | 3.0 cursor | 3.1 camera | 3.2 rail/minimap | 3.3 focus | 3.4 highlight | 3.5 filters | 3.6 story | 3.7 search | 3.8 compare | 3.9 mobile | 3.10 URL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Every number keeps a `source_url` | reads `record`/`basis` | no numbers | counts only (derived) | material rule reuses `amount_in`; panel unchanged | **no path sums**; per-edge amounts only | live-region totals are sums of drawn `amount_in`, caption says "of drawn nodes" | every card sentence carries its `basis` urls / `record` | shows `amount_in` + record | new files carry both records per row | no numbers | none |
| Money ≠ targeting (IEs are not money to a campaign) | `→` from an ad to a candidate announces "aimed at, no money" | n/a | TARGETED column label kept | spine kept as ribbon, arrows as arrows | highlight is opacity/stroke only; arrowheads persist | separate layer group; no filter state renders targeting as a ribbon | step 6 wording fixed | result rows show kind | tables, not ribbons | n/a | `layers=` names kinds, never merges them |
| No causal language | announcements use "gave to / paid / aimed at" | n/a | n/a | crumb uses "›" not "→ funded" | "route", not "flow reached" | "showing dark only" | templated verbs from `node-panel.tsx` (`received from`, `paid to`, `targets`) | n/a | "shared sources", not "coordinated" | n/a | n/a |
| Static data, no runtime fetch | wire only | wire only | layout only | wire only (ancestors already shipped) | BFS on wire | wire only | `adFocusWire` only | wire only | **new prebuilt files**; curated pairs so nothing is fetched on demand | wire only | query string parsed client-side |
| Hand-rolled SVG (D-24) | yes | yes — viewBox on the existing SVG | rail is HTML; minimap is 60 rects | `visibleGraph` extension | class toggles | class toggles | camera + cards | list UI | thumbnails reuse layout | CSS + camera | none |
| Don't amplify C-37/C-59 ambiguities | n/a | n/a | n/a | n/a | n/a | node-vs-edge visibility keyed separately; out-side chips absent | step 5 uses `terminus_reason`, not `visibility`, for "unwalked" | shows funding-side visibility only | rows are funding-side | n/a | `vis=` applies to funding side only |

### 4.1 Library question: d3-zoom? d3-sankey? none?

Measured with esbuild (minified, gzip): `d3-zoom` + `d3-selection` = 48 KB / **16 KB gz**; `d3-sankey` (+ `d3-array`, `d3-shape`) = 8 KB / 2.8 KB gz. `web/` today ships no third-party client code besides React/Next/zod.

**Recommendation: no library.**

- *d3-zoom*: the whole behaviour we need (clamp, zoom-about-point, pan, fit, wheel/pointer/touch handlers) is ~150 lines of pure functions on a `{x,y,w,h}` record and maps 1:1 onto `viewBox`. d3-zoom is imperative (`selection.call(zoom)`) and owns the DOM transform, which fights React's ownership of the `<svg>` attributes and C's hover/click handlers; its default wheel binding hijacks page scroll unless filtered; it brings no a11y (no keyboard, no announcements) — we would write that part anyway. 16 KB gz for the one part we do not need help with is a bad trade.
- *d3-sankey*: still rejected as in D-24. Its layout assigns columns by longest path (`nodeAlign`), not by hop, and sizes every node by value — exactly the false equivalence C-46 removed for ads. We would be overriding both of its core decisions.
- What *is* worth taking from d3 is the pattern, not the code: the bidirectional traversal for highlighting, and zoom-about-pointer math (`k' = k·f; x' = px − (px − x)·f`).

Revisit only if a later requirement needs animated transitions between layouts (re-root morphs); even then `d3-interpolate` alone (≈ 3 KB gz) would suffice.

---

## 5. Feasibility notes (throwaway prototypes, not committed)

### 5.1 `getBBox` / text measurement

Works post-hydration: measuring all 47 WINSENATE labels with `getComputedTextLength()` + `getBBox()` took 0.6 ms. It is **not** available at server render, where `layoutChain` runs (D-24, zero layout flash), so it cannot drive the layout. Two legitimate uses: (a) a client post-pass that swaps a truncated label for the full one when the box is wide enough at the current k (semantic zoom, 3.1); (b) tests. Finding for C: the current truncation is by character count — 8 of 47 labels still overflow their 210-unit box after truncation (e.g. "UNITED BROTHERHOOD OF CARPENTER…" measures 227 units). A build-time width table for the font (one number per glyph, ~2 KB) would make the server layout measurement-accurate; that is C's call.

### 5.2 Zoom legibility

| Method | 2.5× on WINSENATE | Notes |
| --- | --- | --- |
| `viewBox` change | 15.9 px labels, crisp, clipped by the SVG box, hit-testing unchanged | **recommended**; 16 ms/frame for 60 consecutive writes |
| `transform="scale()"` on an inner `<g>` | identical rendering | needs the SVG to be wrapped in a clip; hit-testing fine; no advantage over viewBox |
| CSS `transform: scale()` on the HTML wrapper | crisp (Chrome re-rasterises at rest) but spills over the caption; blurs during animation | rejected |

Text stays vector in all three; there is no legibility reason to re-layout on zoom. Screenshots: `proto-viewbox-zoom.png`, `proto-css-wrapper-zoom.png`.

### 5.3 Other checks

- `.chain-map-scroll` is focusable and scrollable only when the SVG is wider than the viewport (mobile); at 1440 it is not scrollable, so today's "Scrollable funding map" label is wrong on desktop — the toolbar in 3.1 replaces it.
- DOM size is modest (515 elements) — class-toggle highlighting and CSS dimming will not jank; no need for canvas.
- The WINSENATE page is already the heaviest chain page (C-58). None of the proposals add to it except 3.8's prebuilt files, which are separate pages, and 3.5/3.7 which reuse the wire already shipped.

---

## 6. Recommendation — ranked roadmap

All depend on **child C merging first** (C owns `components/chain/*`; its root highlight, label sizing, hover tooltips and edge-table row targeting are the surfaces 3.4 and the "edge → row → edge" idea hook into). Each child gets `chain/*` for its listed files only; anything shared goes in a new file to avoid merge pain.

| Rank | Session | Scope (proposals) | Files owned | Depends on | Success criteria |
| --- | --- | --- | --- | --- | --- |
| **1 — start first** | **H1 · Camera, cursor, path, link** | 3.1 viewBox camera + toolbar + semantic-zoom rule; 3.0 graph cursor + live region; 3.4 path highlight/dim (pinned on select); 3.2 hop rail (minimap optional if time); 3.10 URL state for `sel`, `cam`, `open`, `hide`, `fold` | new `chain/camera.ts`, `chain/graph-nav.ts` (BFS, cursor moves), `chain/url-state.ts`; `chain-diagram.tsx` (wire-up only); additive `.chain-*` CSS | C merged | WINSENATE labels ≥ 11 px at one keystroke (`1:1`); plain wheel still scrolls the page; whole graph operable with keyboard only, announcements verified with a screen reader; hovering FUND FOR POLICY REFORM lights exactly FFPR→Democracy PAC→SMP→WINSENATE; a pasted URL reproduces zoom + selection; camera unit tests |
| 2 | **H2 · Focus & filters & search** | 3.3 expand-one-level / accordion / re-root in place with crumb; 3.5 legend + share-bar chips (visibility solo, edge-kind layers); 3.7 search-in-graph; column-header sort/fold; `focus`, `vis`, `layers` in URL | `view.ts` (`GraphControls.focus`, filter helpers — tests), new `chain/legend-controls.tsx`, `chain/graph-search.tsx`; `chain-diagram.tsx` wire-up; chain page legend/share-bar props | H1 | "dark only" on SLF leaves ONE NATION, AMERICAN PROSPERITY ALLIANCE, ALTRIA, API and HILLWOOD lit ($67.6M) and the caption gives that drawn dark total; no filter state renders a targeting edge without its arrowhead; focusing Democracy PAC draws its own tree + the spine to WINSENATE; searching "simon" surfaces the two folded Simons and opens/fits the chosen one |
| 3 | **H3 · Story mode & mobile** | 3.6 guided walk on ad pages + "Walk this chain" on chain pages; 3.9 narrow-viewport camera default, segmented hop rail, bottom-sheet panel, touch gestures | new `chain/story.ts` (step derivation, tests), `chain/story-stepper.tsx`; ad page + chain page mounting; `.chain-*` CSS | H1 (camera, highlight); H2 optional | every step sentence has a source link; step 2 says "FEC does not record…" for ads with no verified/inferred vendor; at 390 px the root label is ≥ 11 px on first paint and the walk is completable by taps alone |
| 4 (needs §7 answers) | **H4 · Compare & donor index** | 3.8A curated compare pages and/or 3.8B funders index + "appears in N chains" on entity pages, deep-linking with `?focus=` | pipeline: new `compare.py` / `funders_index.py` + additive contract + schema; `app/races/[raceId]/compare/`, entity page section | H2 (focus deep-link); Albert's call on A vs B | every row has two records; shared-source table sorted by min(amount); no runtime fetch |

Total ≈ 3.5–4 sessions; H1 alone delivers the three things the critique named (zoom, pan, navigation) and the a11y model everything else rides on.

---

## 7. Questions for Albert

1. **Wheel policy.** Plain wheel scrolls the page; zoom needs `Ctrl/⌘` (or the toolbar). Observable/Google Maps embed behaviour. OK, or do you want wheel-to-zoom once the map is clicked/focused?
2. **Filter semantics.** Dim (keeps ribbons summing to the root's receipts) vs remove (cleaner picture, totals no longer visible). Spec says dim for disclosure, remove for edge-kind layers. Agree?
3. **Accordion default.** Clicking a node opens its sources and closes sibling openings by default (one story wide). Or keep everything a reader opens until they close it?
4. **Re-root in place vs navigate.** Keep both ("Focus on this node" in place + "Open full page" for the 86 spenders), or only one?
5. **Compare: A (curated side-by-side pairs) or B (donor → every chain it appears in)?** B answers "what else did this donor fund" for every donor and needs one additive index; A needs a curated pair list from you. Both, in that order, is my lean.
6. **Story mode on the chain page too**, or ad pages only in H3? ("Walk this chain" from the largest source is cheap once the ad walk exists.)
7. **Mobile default**: fit-to-height on the spender (pan to explore) vs the story cards as the primary mobile experience with the graph secondary?
8. **URL state scope**: is including `hide=` acceptable (a shared link can omit nodes — the caption will say "N nodes hidden by the person who shared this view")?
9. **Semantic zoom**: acceptable to hide amounts/sub-labels on very short boxes at fit, given the table always has them?

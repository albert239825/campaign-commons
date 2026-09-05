# Citizen Gotham — design-system research

Read-only research deliverable (branch `design/research`). Nothing here is applied to `web/`;
the tokens in §3 and the plan in §5 are ready for a follow-up session to paste.

Evidence: current-UI screenshots in `docs/design/current/` (7 routes × 1440 / 390), proposed
tokens in `docs/design/mockups/tokens.css`, three annotated standalone mockups
(`ledger.html`, `chain.html`, `dossier.html`) with PNG exports in `docs/design/mockups/`.
All numbers in the mockups are hand-copied from `data/out/pa-sen-2024/` (`ledger.json`,
`chains/C00865444.json`, `dossiers/S6PA00217.json`); every figure keeps its government
`source_url`.

**Assumptions (no questions asked, per brief):**

- Audience priority: projector demo first, then a 15-minute voter on a phone. So: contrast and
  size at 1440 on a washed-out projector, then vertical stacking at 390.
- Colour semantics are frozen (disclosed = green, inferable = amber, dark = red, targeting /
  neutral = grey, campaign vs outside = two non-party hues). Only exact values change, and
  only where contrast improves.
- `contracts/src/display.ts` stays the single source of hex values; the proposal is a
  `VISIBILITY_TEXT_COLORS` sibling map for text-on-white, not a replacement of
  `VISIBILITY_COLORS` (fills/bars keep the current values, which pass as large graphics).
- Font loading via `next/font/google` (already in Next 15, zero new dependency) is
  acceptable; if the demo must be offline, self-host from the `inter-ui` / `@fontsource`
  npm packages, both OFL-1.1.
- Screenshots were taken with Playwright at exactly 1440 / 390 viewport widths. Rendered PNGs
  are cropped to a practical height for the very long routes.

---

## 1. Audit of the current UI

### What works (keep)

- **Copy discipline is already right.** "Targeting, not money: none of this reaches the
  campaign", "adjacency, never causation", "dark = a layer whose own funding is not on file"
  — these sentences are on the page and should survive any redesign verbatim.
- **Every number has a link.** `FEC ↗`, `evidence ↗`, `senate.gov roll call`. The
  `SourceLink` primitive exists; it just needs a stronger visual identity (§3.8).
- **Semantic colour is consistent** across bars, dots, legends and the chain diagram.
- **The chain diagram's dark wall** (hatched red node, "DARK WALL" caption, walk stops) is
  the most original element in the product and is visually correct.
- **Density is appropriate.** Tables are single-line, whitespace is modest, no marketing
  hero. The ledger fits the "evidence, not editorial" brief in structure.
- **Mobile does not break.** Cards stack, tables scroll horizontally; nothing overflows.

### The 10 highest-leverage problems (ranked)

| # | Problem | Why it matters | Evidence |
|---|---|---|---|
| 1 | **Semantic colours fail AA as text.** `#1D9E75` on white is 3.4:1, `#EF9F27` is 2.2:1, `#E24B4A` is 3.9:1. Used for "disclosed 66%", "inferable 0%", flag text, and the per-spender dot legend. | The colour *is* the meaning; on a projector amber-on-white disappears entirely and green/red become indistinguishable at the back of the room. | `current/chain-desktop.png` (legend row), `current/ledger-desktop.png` (traceability legend) |
| 2 | **Flags dominate the spenders table and the chain h1.** Three full-sentence amber pills per row ("Chain dead-ends in undisclosed source") push the table to 2–3 lines per spender; on the chain page they wrap the page title onto two lines. | The flags are the most *editorial-looking* element on the page. Long yellow boxes read as warnings, not facts. | `current/ledger-desktop.png` (WINSENATE row), `current/chain-desktop.png` (h1) |
| 3 | **Campaign vs outside money share one dark-grey hue.** The "Campaign vs outside" bar is near-black vs grey; the header KPIs `$94M / $236M` are the same weight and colour. | The product's core comparison (what the campaign raised vs what was spent about them) has no colour identity, while visibility gets three. | `current/ledger-desktop.png` (candidate panels) |
| 4 | **Chain page ships everything.** 461 nodes render in one SVG; the first viewport shows 5 boxes and a sliver of ribbon, the page is 5–6 MB (CRITIQUE C-10). No "top N / all" control. | 5 s TTFB on the demo's marquee page; a judge scrolls a wall of small boxes. | `current/chain-desktop.png`, `current/chain-mobile.png` |
| 5 | **Dossier evidence is a paragraph list, and confidence/needs-review pills repeat 10×.** Each item is `kind · title · long description · source` as running text; "Yea"/"Nay" is buried mid-sentence. | Judges want to see "63 records, here they are" in a glance. The repeated amber "needs review" pill makes the whole dossier look provisional. | `current/dossier-desktop.png` |
| 6 | **No tabular figures, mixed money formats.** Header shows `$94M`, panels show `$58,147,345`, table shows `$63M` + `$60M` + `$2.8M` in the same row; digits are proportional so columns don't align. | Money is the content; misaligned digits are the single biggest "not a finance tool" signal. | `current/ledger-desktop.png` (panels vs table), `current/entity-desktop.png` |
| 7 | **The traceability method is a 9-line paragraph inside the KPI card.** | The most important number on the page (73%) is followed by prose nobody on a projector can read; the caveat matters but should be one line plus a disclosure. | `current/ledger-desktop.png` (traceability card) |
| 8 | **Header/KPI hierarchy is flat.** h1, three right-aligned KPIs and the candidate names are all set in the same neutral weight; the page has no first read. | On a projector the first 2 seconds decide whether the page "reads as evidence". | `current/ledger-desktop.png`, `current/home-desktop.png` |
| 9 | **Source links look like body text.** `FEC ↗` is grey, underlined, 11 px; on the dossier `senate.gov roll call` is plain text. | Provenance is the product promise; the link is the receipt. It must be findable at a glance and consistent across all seven surfaces. | `current/dossier-desktop.png`, `current/entity-desktop.png` |
| 10 | **Mobile tables scroll sideways with the key column off-screen.** Spenders and edge tables keep 8 columns at 390 px; the amount and flags are off-screen. | The voter-on-a-phone use case sees a name column and nothing else. | `current/ledger-mobile.png`, `current/entity-mobile.png`, `current/chain-mobile.png` |

Lower-priority observations (not ranked): the ads gallery cards have inconsistent heights
(`current/ads-desktop.png`); methodology is a good long-form page but uses the same 15 px
body as tables (`current/methodology-desktop.png`); the floating "N" Next.js dev badge is
present in screenshots and is not part of the product.

Screenshot index:

| Route | Desktop 1440 | Mobile 390 |
|---|---|---|
| `/` | `docs/design/current/home-desktop.png` | `docs/design/current/home-mobile.png` |
| `/races/pa-sen-2024` | `ledger-desktop.png` | `ledger-mobile.png` |
| `/races/pa-sen-2024/entities/C00865444` | `entity-desktop.png` | `entity-mobile.png` |
| `/races/pa-sen-2024/chains/C00865444` | `chain-desktop.png` | `chain-mobile.png` |
| `/races/pa-sen-2024/candidates/S6PA00217` | `dossier-desktop.png` | `dossier-mobile.png` |
| `/races/pa-sen-2024/ads` | `ads-desktop.png` | `ads-mobile.png` |
| `/methodology` | `methodology-desktop.png` | `methodology-mobile.png` |

---

## 2. Reference systems

Licensing/availability checked 2026-09-05 against the GitHub license API and the npm
registry (values quoted are what those endpoints returned).

| System | What we'd borrow | Fit | Doesn't fit | Licence / availability |
|---|---|---|---|---|
| **ProPublica data apps** (e.g. Nonprofit Explorer, Represent) | Neutral serif/sans pairing, tables with a single strong left column and right-aligned tabular numbers, one-line methodology footers under every chart, source line under every number. | Exactly the "receipts" register: dense, sober, every figure attributed. | Editorial site chrome (bylines, share bars) irrelevant; they use proprietary fonts. Borrow the *conventions*, not a package. | Conventions only, nothing to install. |
| **The Pudding / FiveThirtyEight-style tables** | 538's sortable tables with tiny caps column headers, inline bars in cells, muted zebra. | Inline bars in the spenders table (traceability as a 60 px bar) would help problem #6/#2. | The Pudding's scrolly-telling is persuasion by pacing; wrong for a "no conclusions" tool. 538 colours are partisan by convention (red/blue) — we must keep party colour text-only and low-chroma. | Conventions only. |
| **Datawrapper / Observable Plot conventions** | Datawrapper's rules: direct labelling instead of legends, grey for "other/aggregate", one accent per message, annotations set in the same typeface as the body. Observable Plot for any future charts (small footprint, works in RSC via server-side SVG or client component). | Our bars already follow this mostly; the chain diagram should adopt "grey aggregate, hatched dark, uniform ribbon opacity". Plot is ISC-licensed and pure SVG — fits Next 15 without a framework change. | Plot is a chart library, not a design system; only pull it in if a *new* chart is needed (none is required by the plan below). | Observable Plot `0.6.17` on npm (published 2025-02-14), ISC. Datawrapper is a hosted product — conventions only. |
| **shadcn/ui on Radix primitives** (component base) | `Table`, `Badge`, `Tooltip`, `Collapsible`, `Tabs`, `Sheet` (mobile filters), copy-paste source into `web/src/components/ui`. Tailwind 4 support is in the current CLI. | Native fit: Next.js 15 + Tailwind 4 + RSC, no runtime CSS-in-JS, components are owned source so our semantic tokens override cleanly. Radix primitives give keyboard/a11y for the few interactive bits (collapsible method note, "top 8 / all" toggle). | Default look is "SaaS dashboard" (rounded-xl, shadows). We override radii to 3–6 px and remove shadows. Adds `@radix-ui/*` + `class-variance-authority` deps — small, but the brief says log any dependency, so it is the *last* step in §5, and every earlier step is done with plain Tailwind. | shadcn/ui repo: MIT. Radix primitives: MIT. |
| *(rejected)* **Radix Themes** | Full theme with its own CSS variables. | — | Brings its own token layer and `Theme` provider that fights Tailwind 4's `@theme`; colours are scale-based (`--green-9`) not semantic. | `@radix-ui/themes` 3.3.0, MIT (WorkOS). Not recommended. |
| *(rejected)* **Geist** (Vercel) | Geist Sans / Geist Mono fonts and design language. | Mono has good tabular digits. | The look is unmistakably "Vercel dashboard"; for a civic-evidence tool the association is wrong, and Geist Sans's large x-height makes 13 px table text look bigger than Inter's at the same density. | Fonts are OFL (npm `geist` 1.7.2). Fine, just not chosen. |

**Typography pair evaluated**

| Role | Choice | Why | Licence |
|---|---|---|---|
| UI / body / headings | **Inter** (variable, `font-feature-settings: "tnum", "cv11"`) | Best hinted screen sans at 12–15 px, native tabular figures via `tnum`, ships with `next/font/google`. Heading weight 600–700 is enough hierarchy; no serif needed. | OFL-1.1 (`rsms/inter`; npm `inter-ui` 4.1.1) |
| Numbers, IDs, FEC codes | **IBM Plex Mono** 400/500 | Tabular by nature, distinguishes `0/O`, `1/l`; matches Inter's weight at 13 px; visibly "record-like" for committee IDs and bill IDs. | OFL-1.1 (`IBM/plex`; npm `@fontsource/ibm-plex-mono` 5.3.0) |
| *(considered)* Source Serif 4 for headings | Adds editorial warmth, but the brief asks for evidence not editorial; a serif h1 reads as a newspaper. Not used. | OFL-1.1 (`adobe-fonts/source-serif`) |

---

## 3. Recommendation

**One system: "Ledger" — Inter + IBM Plex Mono, Tailwind 4 `@theme` tokens, shadcn-style
owned components, Datawrapper chart rules.** Keep the app's structure; change the token layer,
the number rendering, and five components. No framework swap, no new build step.

### 3.1 Type scale (rem, Inter unless noted)

| Token | Size | Line | Use |
|---|---|---|---|
| `text-2xs` | 11 px | 1.3 | column headers (caps, +0.06 em), chip labels, footnotes |
| `text-xs` | 12 px | 1.3 | source links, table meta, legends |
| `text-sm` | 13 px | 1.5 | **table body default**, evidence rows |
| `text-base` | 15 px | 1.5 | prose, card body |
| `text-lg` | 18 px | 1.3 | card h2 (weight 600) |
| `text-xl` | 24 px | 1.15 | page h1 (weight 700, −0.01 em) |
| `text-2xl` | 32 px | 1.15 | race h1 on desktop |
| `text-stat` | 44 px | 1 | KPI numbers (Plex Mono 500, `tnum`) |

Rule: numbers in tables are the same size as the text next to them; only KPI stats are large.

### 3.2 Spacing, radii, layout

- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 (Tailwind default; use `p-3 / p-4`
  for cards, `py-1.5 px-2` for dense cells, `py-2 px-2.5` for default cells).
- Radii: `xs 2 px` (tags), `sm 3 px` (chips, inputs), `md 6 px` (cards), `pill 999` (party,
  confidence). No radius above 6 px anywhere; no drop shadows — 1 px borders only.
- Container `max-w-[1200px]`, prose measure `68ch`. Two-column card grids collapse at 720 px.

### 3.3 Semantic colour tokens

Fills (bars, dots, ribbons, ≥3 px) may keep the current `display.ts` values; **text** uses a
darker sibling that passes AA on white. Dark theme lightens fills and uses them for text too
(all ≥ 4.5:1 on `#0f1115`, checked with WCAG relative-luminance formula).

| Token | Light fill | Light text (on white) | Dark theme | Meaning |
|---|---|---|---|---|
| `disclosed` | `#1D9E75` (unchanged) | `#0E7A57` — 5.3:1 | `#3DCB98` | resolves to a named donor / treasury |
| `inferable` | `#B8760F` (was `#EF9F27`, 2.2:1) | `#9A5B00` — 5.4:1 | `#F2B546` | reconstructable from 990s |
| `dark` | `#DC4A47` (≈ unchanged) | `#B42323` — 6.6:1 | `#F0706E` | no donor-disclosure obligation |
| `neutral` / `targeting` | `#A3A3A0` / `#73726C` (unchanged) | `#6B7280` | `#7C839A` | aggregate, not walked, IE targeting edge |
| `campaign` | `#1E293B` | same | `#C7D0E0` | money the campaign committee received |
| `outside` | `#6D4BD8` | same (5.8:1) | `#A48BFF` | independent expenditures about the candidate |
| `flag` | bg `#FFF8EA` / border `#E0B36A` | `#8A4B00` | bg `#2A2314` | structural flag (descriptive) |
| `party-dem` / `party-rep` | text-only `#2B4C8C` / `#8C2B2B` | — | `#8AB4F8` / `#F0908E` | never used for money or bars |
| `link` | — | `#1F4E9E` | `#8AB4F8` | source links |

Inferable's *fill* is darkened because amber at `#EF9F27` is invisible on projector white next
to green; the hue is kept. Dark's fill is nudged one step so the hatched pattern reads.

### 3.4 Number formatting rules

1. All digits `font-variant-numeric: tabular-nums` (Inter `tnum`), right-aligned in tables.
2. Compact form for anything in a comparison row or KPI: `$63.0M`, `$5.1M`, `$833K` — **one
   decimal under $100M, none above** (`$236M`). Today's `money()` drops the decimal at ≥ $10M,
   which makes `$63M` vs `$60M` + `$2.8M` fail to sum visibly.
3. Full form (`$312,850,000`) only in the first column of a detail table or as the sub-line
   under a KPI. Never both forms in one cell.
4. Percentages: integer by default; one decimal only when comparing shares below 10 %.
5. IDs (`C00865444`, `H.R.5376-117`, FEC transaction types `18K`) always in Plex Mono, never
   coloured.
6. Dates `2024-05-21` ISO in tables, `May 2023 – Oct 2024` for ranges.

### 3.5 Table density

- Default rows 32 px (`py-2`), `tight` rows 26 px for edge tables and evidence tables.
- Column header: `text-2xs` caps, `border-b` 1 px `border-strong`; no background fill.
- Zebra `surface-2` on even rows; hover = same tint darker. Sorted column header underlined.
- ≤ 8 columns at 1440. Below 720 px, tables with > 4 columns become **stacked rows** (see
  `ledger-mobile.png`): first column as row title, numbers as a label/value pair, low-value
  columns hidden (`hide-m`). Never horizontal scroll for the primary table on a page.
- Inline bar cell (traceability): 64 px wide, 6 px tall, three segments, percentage in text
  to its right — colour is never the only channel.

### 3.6 Chips, flags, badges

- `chip`: 11 px, 1 px border, 3 px radius, 2×8 px padding, `surface` background.
- **Flag chip**: `⚑ ` + short noun (`single source`, `dark dead-end`, `shared address`,
  `late start`) in `flag` colours. Detail lives in a `title` attribute and a collapsible
  legend, never in the row.
- Visibility appears as a labelled text cell (`● disclosed`, `● dark wall`, `● not walked`)
  in `*-text` colour — dot plus word, never a bare dot.
- Party is a text-only pill; role (`Incumbent` / `Challenger`) is a neutral chip.
- Evidence kind tags on the dossier: `ROLL CALL 325` (blue-grey solid), `SPONSORED` (violet
  solid), `STATED POSITION` (grey **dashed**) so record and statements can't be confused.

### 3.7 Source links

`SourceLink` renders `label ↗` in `link` colour, 12 px, dotted underline, `whitespace-nowrap`,
right-aligned as the last column of every table. Label is the host (`FEC`, `senate.gov`,
`congress.gov`, `archive.org`) not the word "source". `rel="noreferrer"`. Same component on all
seven surfaces; 12 px minimum hit target height is 24 px via padding.

### 3.8 Tailwind theme snippet (paste into `web/src/app/globals.css`, not applied)

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-2xs: 0.6875rem; --text-2xs--line-height: 1.3;
  --text-xs: 0.75rem;    --text-xs--line-height: 1.3;
  --text-sm: 0.8125rem;  --text-sm--line-height: 1.5;
  --text-base: 0.9375rem;--text-base--line-height: 1.5;
  --text-lg: 1.125rem;   --text-lg--line-height: 1.3;
  --text-xl: 1.5rem;     --text-xl--line-height: 1.15;
  --text-2xl: 2rem;      --text-2xl--line-height: 1.15;
  --text-stat: 2.75rem;  --text-stat--line-height: 1;

  --radius-xs: 2px; --radius-sm: 3px; --radius-md: 6px;

  --color-bg: var(--bg); --color-surface: var(--surface); --color-surface-2: var(--surface-2);
  --color-border: var(--border); --color-border-strong: var(--border-strong);
  --color-ink: var(--ink); --color-ink-2: var(--ink-2); --color-ink-3: var(--ink-3);
  --color-link: var(--link);

  --color-disclosed: var(--disclosed-fill); --color-disclosed-text: var(--disclosed-text); --color-disclosed-bg: var(--disclosed-bg);
  --color-inferable: var(--inferable-fill); --color-inferable-text: var(--inferable-text); --color-inferable-bg: var(--inferable-bg);
  --color-dark: var(--dark-fill);           --color-dark-text: var(--dark-text);           --color-dark-bg: var(--dark-bg);
  --color-neutral: var(--neutral-fill);     --color-neutral-text: var(--neutral-text);
  --color-targeting: var(--targeting);
  --color-campaign: var(--campaign); --color-outside: var(--outside);
  --color-flag-text: var(--flag-text); --color-flag-border: var(--flag-border); --color-flag-bg: var(--flag-bg);
  --color-party-dem: var(--party-dem); --color-party-rep: var(--party-rep);
}

@layer base {
  html { font-feature-settings: "tnum", "cv11"; }
  body { @apply bg-bg text-ink antialiased; }
  .num, td.r, .stat { font-variant-numeric: tabular-nums; }
}
```

Usage then reads `text-disclosed-text`, `bg-dark-bg`, `border-flag-border`, `text-stat`,
`rounded-sm`. Because `@theme inline` references the CSS variables below, the dark variant is a
class on `<html>` with no Tailwind config.

### 3.9 CSS variables (paste-ready; identical to `docs/design/mockups/tokens.css` `:root`)

```css
:root {
  --bg: #fafaf9; --surface: #ffffff; --surface-2: #f4f4f2;
  --border: #e4e4e0; --border-strong: #c9c9c4;
  --ink: #111318; --ink-2: #4b5563; --ink-3: #6b7280;
  --link: #1f4e9e; --focus: #1f4e9e;

  --disclosed-fill: #1d9e75; --disclosed-text: #0e7a57; --disclosed-bg: #e6f5ee;
  --inferable-fill: #b8760f; --inferable-text: #9a5b00; --inferable-bg: #fbf1dd;
  --dark-fill: #dc4a47;      --dark-text: #b42323;      --dark-bg: #fbe9e8;
  --neutral-fill: #a3a3a0;   --neutral-text: #6b7280;
  --targeting: #73726c;
  --campaign: #1e293b; --outside: #6d4bd8;
  --flag-text: #8a4b00; --flag-border: #e0b36a; --flag-bg: #fff8ea;
  --party-dem: #2b4c8c; --party-rep: #8c2b2b; --party-oth: #4b5563;
}
.theme-dark, [data-theme="dark"] {
  --bg: #0f1115; --surface: #161a22; --surface-2: #1c212b;
  --border: #2a2f3a; --border-strong: #3a404d;
  --ink: #e6e8ee; --ink-2: #a3a9b7; --ink-3: #7c839a;
  --link: #8ab4f8; --focus: #8ab4f8;
  --disclosed-fill: #3dcb98; --disclosed-text: #3dcb98; --disclosed-bg: #123527;
  --inferable-fill: #f2b546; --inferable-text: #f2b546; --inferable-bg: #3a2c10;
  --dark-fill: #f0706e;      --dark-text: #f0706e;      --dark-bg: #3c1c1c;
  --neutral-fill: #6b7280;   --neutral-text: #a3a9b7;
  --campaign: #c7d0e0; --outside: #a48bff;
  --flag-text: #f2c66d; --flag-border: #6b4f1a; --flag-bg: #2a2314;
  --party-dem: #8ab4f8; --party-rep: #f0908e; --party-oth: #a3a9b7;
}
```

`contracts/src/display.ts` addition (additive, follow-up session; keeps `VISIBILITY_COLORS`):

```ts
export const VISIBILITY_TEXT_COLORS: Record<Visibility, string> = {
  disclosed: "#0E7A57", inferable: "#9A5B00", dark: "#B42323",
};
export const MONEY_COLORS = { campaign: "#1E293B", outside: "#6D4BD8" } as const;
```

---

## 4. Component inventory

Existing files are under `web/src/components/`. "Mockup" points at where the proposal is drawn.

| Surface | Current component | Proposed | Mockup |
|---|---|---|---|
| Race table (home) | `race-table/race-row.tsx` | `RaceRow`: race name (link) · date · candidates as party-pill + name · campaign `$` in `campaign` · outside `$` in `outside` · outside-share inline bar · traceability bar+% · `FEC` source. Tabular numbers, 32 px rows. | — (rules in §3.5) |
| Ledger candidate panels | `ledger/candidate-panel.tsx`, `ui/stacked-bar.tsx` | `CandidatePanel`: two KPI blocks side by side (Campaign in `campaign`, Outside in `outside`), then a `campaign` vs `outside` two-tone bar, then a compact receipts breakdown with `SourceLink` per line and the targeting note as one italic line. | `ledger.html` ① ② |
| Traceability card | `ledger/traceability-card.tsx`, `ui/share-bar.tsx` | `TraceabilityCard`: 44 px stat + "preliminary" chip, three-segment bar (dark segment hatched) with `$ · %` labels under each segment, one-sentence definition, `<details>` "How this is computed". | `ledger.html` ③ |
| Spenders table | `ledger/spenders-table.tsx`, `ledger/flags-legend.tsx`, `ui/table.tsx` | `SpendersTable`: spender (name + mono ID) · type · supports/opposes as compact `S $ · O $` two-liner · in-race `$` · traceability **inline bar + %** · flags as short `⚑` chips · `entity / chain / FEC`. Stacked rows < 720 px. | `ledger.html` ④ ⑤, `ledger-mobile.png` |
| Entity header / flows | `entity/entity-header.tsx`, `entity/flows-table.tsx`, `entity/ie-table.tsx` | Header: name, type chip, mono ID, flags chip row, `FEC` link right. Flows table gets a labelled visibility column and share %. IE table keeps the "targeting, not money" note in the header line, uses `outside` colour for amounts. | chain header ①, edge table ⑤ apply |
| Chain diagram | `chain/chain-diagram.tsx`, `chain/layout.ts` | Top 8 sources per hop by default, "Top 20 / Everything" toggle (client component wrapping server-rendered SVG variants); hop column headers; uniform ribbon opacity; hatched `dark` nodes with "DARK WALL" caption (keep); grey dashed aggregates. Solves C-10 by rendering the small variant server-side and lazy-loading the full one. | `chain.html` ④ |
| Chain edge table | `chain/edge-table.tsx` | `EdgeTable` `tight`: from · kind · visibility (text + dot; `not walked` distinct from `disclosed`) · amount · share · transfers · date range · FEC types (mono) · `FEC`. | `chain.html` ⑤ |
| Chain findings | inline in `chains/[entityId]/page.tsx` | `FindingsList`: 3-column grid `flag · sentence · evidence`, header "Descriptive, from filings." | `chain.html` ③ |
| Dossier issue sections | `dossier/issue-section.tsx`, `dossier/issue-nav.tsx` | Sticky `IssueNav` with evidence counts (chip row on mobile); `IssueSection` header = label · confidence pill · needs-review chip · `n votes · n bills`; position paragraph at `68ch`. | `dossier.html` ③ ④ |
| Dossier evidence list | `dossier/evidence-list.tsx` | `EvidenceTable` `tight`: date · kind tag (`ROLL CALL n` / `SPONSORED` / dashed `STATED POSITION`) · vote `▲ Yea` / `▼ Nay` in text · measure + one-line description · ID mono · source. Stacked rows on mobile. | `dossier.html` ④ ⑥ |
| Dossier evidence-basis bar | `asymmetry_note` rendered as prose | `EvidenceBasis` bar: black label `EVIDENCE BASIS: RECORD` / `STATED`, note text, single "needs review" explanation. | `dossier.html` ② |
| Ad cards | `ads/ad-card.tsx`, `ads/ad-gallery.tsx` | Fixed-height cards: sponsor (link to entity) · platform chip · date range · spend range in `outside` · target as `S/O name` · issue chips · `archive.org / Google` source. Grid of 3 / 2 / 1. | — (rules §3.5–3.7) |
| Flag badges | `ui/chip.tsx` `FlagBadge` | `FlagChip`: `⚑ short-noun`, `title` = long text, colours `flag-*`. Legend becomes `<details>` under the table. | `ledger.html` ⑤, `chain.html` ① |
| Source links | `ui/chip.tsx` `SourceLink` | As §3.7; host label; used on every row of every table. | all mockups |
| Data-status banner | `ui/index.tsx` `DataStatusBanner` | Unchanged content; `flag-*` colours for `partial`, `neutral` for `mock`. | — |

---

## 5. Implementation plan (ordered; pick a cut line)

Each step is independent of the ones after it and keeps `npm run lint && npm run typecheck &&
npm run build` green. Effort: S ≤ 1 h, M ≤ 3 h, L ≤ 1 day of one session.

| # | Change | Effort | Files touched |
|---|---|---|---|
| 1 | **Tokens.** Paste §3.9 variables and §3.8 `@theme` into `globals.css`; add `tnum` globally; add `VISIBILITY_TEXT_COLORS` + `MONEY_COLORS` to contracts. Replace `text-disclosed` etc. used on *text* with `text-disclosed-text` (grep). | S | `web/src/app/globals.css`, `contracts/src/display.ts`, `web/src/components/ui/legend.tsx`, `ui/chip.tsx` |
| 2 | **Fonts.** `next/font/google` Inter + IBM Plex Mono with CSS variables `--font-inter`, `--font-plex-mono`; `className` on `<html>`. No new dependency. | S | `web/src/app/layout.tsx` |
| 3 | **Money formatting.** `money()` one decimal below $100M; `Money` component gets `tabular-nums` + right-align by default; `Stat` uses `text-stat` mono. | S | `web/src/lib/format.ts`, `web/src/components/ui/index.tsx` |
| 4 | **Flag chips.** Short-noun labels map (`FLAG_LABELS` next to `FLAG_DESCRIPTIONS`), `title` tooltip, legend moves into `<details>`. Fixes chain h1 wrap and spenders row height. | S | `contracts/src/display.ts` (additive map), `ui/chip.tsx`, `ledger/flags-legend.tsx`, `ledger/spenders-table.tsx`, `chains/[entityId]/page.tsx`, `entity/entity-header.tsx` |
| 5 | **SourceLink restyle** (host label, link colour, nowrap, last column) and apply to dossier evidence. | S | `ui/chip.tsx`, `dossier/evidence-list.tsx`, `entity/*.tsx`, `chain/edge-table.tsx` |
| 6 | **Traceability card**: stat + bar with `$ · %` labels + hatched dark + `<details>` method. | S | `ledger/traceability-card.tsx`, `ui/share-bar.tsx` |
| 7 | **Candidate panels**: campaign/outside KPI pair in the two money hues, two-tone bar, targeting note as one line. | M | `ledger/candidate-panel.tsx`, `ui/stacked-bar.tsx` |
| 8 | **Spenders table**: inline traceability bar cell, `S/O` compact cell, visibility as text+dot, stacked-row layout < 720 px (`Table` gains `stack` prop with `data-label` cells). | M | `ui/table.tsx`, `ledger/spenders-table.tsx` |
| 9 | **Dossier**: `EvidenceTable`, `EvidenceBasis` bar, sticky `IssueNav` with counts, single needs-review explanation, dashed `stated_position` tag. | M | `dossier/evidence-list.tsx`, `dossier/issue-section.tsx`, `dossier/issue-nav.tsx`, `candidates/[candidateId]/page.tsx` |
| 10 | **Chain findings grid + edge table** columns (share %, visibility text, `not walked`). | S | `chains/[entityId]/page.tsx`, `chain/edge-table.tsx` |
| 11 | **Chain diagram top-N** with client toggle; server renders top-8 SVG, full SVG behind `dynamic()`/on click. Also closes C-10. | L | `chain/chain-diagram.tsx`, `chain/layout.ts`, new `chain/diagram-toggle.tsx` (client), `chains/[entityId]/page.tsx` |
| 12 | **Header hierarchy**: h1 `text-2xl`, KPI trio as `Stat`s with hue, breadcrumbs `text-xs`. | S | `races/[raceId]/page.tsx`, `app/page.tsx`, `ui/index.tsx` |
| 13 | **Ad cards** fixed height + `outside` colour + host source label. | S | `ads/ad-card.tsx`, `ads/ad-gallery.tsx` |
| 14 | **Dark theme toggle** for the projector: `data-theme` on `<html>`, tiny client toggle in header, `prefers-color-scheme` default. | S | `app/layout.tsx`, new `ui/theme-toggle.tsx` |
| 15 | *(optional)* **shadcn/ui** `Table`, `Tooltip`, `Collapsible`, `Tabs` — only if steps 8/11 want richer interaction. Adds `@radix-ui/react-*`, `class-variance-authority`, `clsx`, `tailwind-merge`; log in `DECISIONS.md`. | M | `web/package.json`, `web/src/components/ui/*` |

Suggested cut lines: **1–6** (≈ half a session) fixes problems 1, 2, 6, 7, 9; **1–10** fixes
everything but the chain payload and mobile tables; **1–14** is the full recommendation.

---

## 6. Mockups

Standalone HTML, open directly in a browser (they load Inter / Plex Mono from Google Fonts;
they degrade to system fonts offline). Numbered blue badges are annotations and are explained
in the panel at the bottom of each file.

| Mockup | File | PNG |
|---|---|---|
| Ledger `/races/pa-sen-2024` | `docs/design/mockups/ledger.html` | `ledger-desktop.png` (1440), `ledger-mobile.png` (390) |
| Chain `/races/pa-sen-2024/chains/C00865444` | `docs/design/mockups/chain.html` | `chain-desktop.png` |
| Dossier `/races/pa-sen-2024/candidates/S6PA00217` | `docs/design/mockups/dossier.html` | `dossier-desktop.png` |
| Tokens | `docs/design/mockups/tokens.css` | — |

Copy rules honoured in every mockup: money edges only in the chain; independent expenditures
are "targeting, not money"; "dark" is used only for a layer with no donor-disclosure
obligation; super PACs are labelled disclosed; no "bought / influenced / in exchange"; position
summaries describe votes and bills and never a motive.

### Known gaps in this deliverable

- Chain and dossier have desktop mockups only; the mobile treatment for their tables is
  specified in §3.5 and demonstrated by the ledger mobile mockup.
- The chain mockup's Sankey is hand-laid for the top 8 of 24 hop-2 sources; the remaining 16
  are summarised as one row ("+16 more · $75.0M"), which is the intended default UI, not an
  omission of data.
- No dark-theme PNG was rendered; the dark tokens are in `tokens.css` under `.theme-dark`
  and were contrast-checked numerically, not visually on a projector.

# Record-page design update

The remaining page templates now follow the current landing page and Pennsylvania
race dashboard: Scto Grotesk A, warm paper (`#f2efeb`), sand panels (`#e9e5df`),
soft blue-to-sand banners, regular-weight headings, thin rules, and square controls.
This continues the `design/bayshore-landing` work.

| Page | Changes | Screenshots |
| --- | --- | --- |
| Candidate profiles | Banner with comparison links, readable summary and evidence, issue navigation on desktop and mobile. Applies to both candidates. | [Desktop](candidate-desktop.png), [mobile](candidate-mobile.png) |
| Committee/entity profiles | Banner, structured committee information, and section navigation for funding sources, inflows, outflows, and independent expenditures. | [Desktop](entity-desktop.png), [mobile](entity-mobile.png) |
| Funding chains | Banner, direct links to the overview/map/receipts, clearer findings and statistics, keyboard-scrollable map and records. | [Desktop](chain-desktop.png), [mobile](chain-mobile.png) |
| Donor views | Banner, larger statistics, more readable forward tree, and preserved distinction between money transfers and targeting edges. | [Desktop](donor-desktop.png), [mobile](donor-mobile.png) |
| Political ads | Larger uncropped creatives, square sand cards, usable filter controls, and a live result count. | [Desktop](ads-desktop.png), [mobile](ads-mobile.png) |
| Funding highlights/stories | Banner and a responsive grid matching the existing race highlights, retaining the complete narratives. | [Desktop](stories-desktop.png), [mobile](stories-mobile.png) |
| Methodology | Matching banner, section navigation, and a wider, more readable long-form layout. | [Desktop](methodology-desktop.png), [mobile](methodology-mobile.png) |

The changes are scoped to record pages. Shared components receive styling hooks,
with the existing landing and race page styles retained. Data, financial
calculations, source links, verification labels, and methodological caveats remain.
Funding-status text uses darker colors on the warm background for readability.

Validation:

- Lint and TypeScript checks passed.
- Production build passed and generated all 2,147 pages. An isolated source copy
  was used to avoid concurrent development sessions sharing the Next.js cache.
- All seven page types, including both candidate profiles, returned HTTP 200 at
  1440, 768, 390, and 320px: 32 responsive checks, without page overflow or browser
  runtime errors. Wide maps and receipt tables scroll within their own containers.
- Verified ad filters/sort/reset, live counts, candidate comparison, all section
  links, mobile keyboard navigation, map expansion, additional receipts, and
  keyboard scrolling. Also checked the existing race overview and highlights.

The implementation is in the seven page templates, the new
`web/src/components/ui/detail-layout.tsx`, and the scoped record-page styles at the
end of `web/src/app/globals.css`.

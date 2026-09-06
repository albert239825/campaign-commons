# Open questions

Undecided. When one is decided: add a `D-nn` row to [DECISIONS.md](DECISIONS.md) and delete it here. Keep the ID stable.

| ID | Question | Options / current lean | Raised by |
| --- | --- | --- | --- |
| Q-01 | Move chains to a graph DB? | Not for one race; revisit if runtime ad hoc traversal or multi-race scope arrives. Interim: recursive CTE in DuckDB. Lean: stay static. | Albert |
| Q-02 | UI redesign cut line ([DESIGN.md](DESIGN.md) §5). | Steps 1–6 / 1–10 / 1–14. Rec: 1–10 + 12, skip 11 and 15. On hold. | master |
| Q-03 | Compact money precision in headline stats ($233M vs $233.4M). | Show one decimal above $10M; exact on hover. | testing agent |
| Q-04 | Campaign spending side (vendor-level Schedule B) — build it? | Would complete "campaign vs outside" as a two-sided ledger. Cost ~half a session; needs Schedule B in the neighborhood. | Albert |
| Q-05 | Second real race (TX Senate 2026 is a stub). | Pipeline is race-parameterised; needs a Schedule E pull and ads bundle for the cycle. | master |
| Q-06 | Public deploy. | Vercel from `web/` on `main`, no env vars. Albert setting up. | Albert |
| Q-07 | Critic P2s C-37..C-43 (edge colour semantics, design-doc drift, unused contract fields, donor-key dedupe, IE amount semantics, name normalisation). | Do before or after UI work? | critic r2 |
| Q-08 | Whiteboard feature set and data model changes. | Pending Albert's whiteboard notes; map against `contracts/src/schemas.ts`. | Albert |
| Q-11 | Pull Schedule B for outside spenders (non-IE spending: consultants, overhead) and for the campaigns (media lines)? | IE rows cover the large majority of super PAC outflows; Block 2 starts without B. Needs `oppexp24` bulk or the OpenFEC key re-added. Block 3 candidate. | master |
| Q-13 | **Answered by D-78.** Use an LLM-assisted first pass in a separately labelled, provenance-carrying machine layer with human review; record-based fields remain authoritative. | D-78 | Albert |

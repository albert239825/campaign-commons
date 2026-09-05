# Citizen Gotham docs

Start here. One document per job; don't duplicate content across them — link.

| Doc | Job | Update when |
| --- | --- | --- |
| [FAQ.md](FAQ.md) | Glossary + questions a teammate/judge asks and the answer we give. | Someone asks a question we had to think about. |
| [LOG.md](LOG.md) | Build log: timeline, challenges and how they were solved, dead ends, numbers over time. Presentation source. | Every PR appends an entry. |
| [ONTOLOGY.md](ONTOLOGY.md) | Questions × surfaces matrix, ER diagram of the data model, field-level sources (actual and candidate). | A question, entity, field or source is added. |
| [QUESTIONS.md](QUESTIONS.md) | Open questions and proposed changes that nobody has decided yet. | A question is raised; when it's decided, move it to DECISIONS.md and delete it here. |
| [DECISIONS.md](DECISIONS.md) | Append-only log of decisions (`D-nn`): what, why, who. | Any choice that constrains later work — data semantics, scope, stack, copy rules. |
| [PLAN.md](PLAN.md) | How the system is built: architecture, pipeline stages, data sources. | Architecture or a stage changes. |
| [plans/](plans/) | One file per work block: what is landing, which child builds what, ownership, sequence. Merged to `main` before the block starts. | A new block is scoped. |
| [CONTRACTS.md](CONTRACTS.md) | The JSON files the app reads and the schemas they must satisfy. | `contracts/src/schemas.ts` changes. |
| [DESIGN.md](DESIGN.md) | UI design research, tokens, ranked UI fixes. | Design direction changes. |
| [CRITIQUE.md](CRITIQUE.md) | Critic findings (`C-nn`) with status. | A critic round runs; a finding is closed. |
| [SATURDAY.md](SATURDAY.md) | Current state: what's real, headline numbers, caveats, what's next. | A stage lands on `main`. |

## Conventions

- **IDs.** Decisions `D-nn`, critic findings `C-nn`, open questions `Q-nn`. Cross-reference by ID.
- **Lifecycle of a question.** Asked → written in FAQ.md if it's answerable from what exists, otherwise in QUESTIONS.md →
  decided → `D-nn` in DECISIONS.md (one row, with the why) → removed from QUESTIONS.md → FAQ.md answer links the `D-nn`.
- **Source of truth for numbers** is `data/out/`, not any doc. Docs quote numbers with the date/commit they were true at.
- **Copy rules** (adjacency not causation, every number has a `source_url`, money edges ≠ targeting edges) live in the
  repo README and are not restated elsewhere.
- Child sessions: log, don't ask — add the `D-nn` row and move on. Anything you're unsure about goes in QUESTIONS.md.

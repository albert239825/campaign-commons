"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type MouseEvent } from "react";
import {
  FLAG_LABELS,
  ISSUE_BY_ID,
  VISIBILITY_COLORS,
  type FlagId,
  type FocusKind,
  type IssueFocus,
  type OutsideSpender,
  type Party,
  type RaceCandidate,
  type Story,
} from "@campaign-commons/contracts";
import { money, pct, routes } from "@/lib/format";
import { Chip, FlagBadge, Money, SourceLink } from "@/components/ui";
import { StackedBar } from "@/components/ui/stacked-bar";
import { FOCUS_KIND_LABELS } from "@/components/issues/focus-kind";
import { FLAG_MEANINGS, FlagsLegend } from "./flags-legend";
import { SpendersTable, displayName } from "./spenders-table";

type StoryKind = Story["kind"];

const STORY_KIND_LABELS: Record<StoryKind, string> = {
  biggest_spender: "Biggest spender",
  dark_dead_end: "Dark wall",
  popup: "Pop-up committee",
  single_transfer: "One source",
  ad_to_chain: "Ad → chain",
};

const STORY_KIND_MEANINGS: Record<StoryKind, string> = {
  biggest_spender: "The committee reporting the most independent expenditures about candidates in this race.",
  dark_dead_end: "A large share of traced receipts ends at organizations with no donor disclosure on file.",
  popup: "First activity after the pre-general cutoff, so no donor report was on file when the spending started.",
  single_transfer: "Funded mostly by a single transfer from one counterparty.",
  ad_to_chain: "An ad in the gallery traces back through this committee's funding chain.",
};

const FOCUS_KIND_MEANINGS: Record<FocusKind, string> = {
  general_partisan: "Party-aligned or leadership-linked committee whose stated purpose is winning seats, not one issue.",
  candidate_aligned: "Describes itself as a vehicle for one candidate.",
  business_trade: "A business or trade association speaking for an industry.",
  labor: "A labor union or union-funded committee.",
  single_issue: "Organized around one policy issue in its own words.",
  multi_issue: "Advocates on several named issues.",
};

/** Short headline per kind, answering "what is this group for?" at a glance. */
const FOCUS_KIND_HEADLINES: Record<FocusKind, string> = {
  general_partisan: "General partisan platform",
  candidate_aligned: "Single-candidate vehicle",
  business_trade: "Industry / trade group",
  labor: "Labor union",
  single_issue: "Single issue",
  multi_issue: "Multi-issue agenda",
};

const PARTY_SIDE: Record<Party, string> = {
  DEM: "Democratic",
  REP: "Republican",
  LIB: "Libertarian",
  GRE: "Green",
  IND: "independent",
  CON: "Constitution",
  OTH: "other-party",
};

const FOCUS_KINDS: readonly FocusKind[] = ["general_partisan", "single_issue", "multi_issue", "business_trade", "labor", "candidate_aligned"];

/** `group:id` so one native select can carry all three groups. */
type CategoryKey = `highlight:${StoryKind}` | `flag:${FlagId}` | `focus:${FocusKind}` | "all";

type Category = { key: CategoryKey; label: string; meaning: string };

type CardModel = {
  spender: OutsideSpender;
  story: Story | null;
  focus: IssueFocus | null;
  categories: Set<CategoryKey>;
};

const isVerified = (story: Story | null): story is Story => Boolean(story?.verified && story.verified_by_url);

/** Dark share of traced receipts: the visibility bucket when computed, else the traceability complement, else null. */
function darkShare(s: OutsideSpender): { share: number; exact: boolean } | null {
  if (s.visibility_shares) return { share: s.visibility_shares.dark, exact: true };
  if (s.traceability_score !== null) return { share: 1 - s.traceability_score, exact: false };
  return null;
}

/** One line per (candidate, support/oppose) pair, largest first. Targeting, never money to a campaign. */
function targetingLine(s: OutsideSpender, lastName: Map<string, string>): string {
  const sums = new Map<string, number>();
  for (const row of s.by_candidate) {
    const k = `${row.candidate_id}|${row.support_oppose}`;
    sums.set(k, (sums.get(k) ?? 0) + row.amount);
  }
  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, amount]) => {
      const [cid, so] = k.split("|");
      return `${so === "S" ? "Supports" : "Opposes"} ${lastName.get(cid) ?? cid} ${money(amount)}`;
    })
    .join(" · ");
}

/**
 * Which party's side this spender's declared IE targeting lands on in this race: support dollars count for the
 * candidate's party, oppose dollars for the other party when the race has exactly two. Null when there is no
 * declared targeting or the parties tie. Read off the same Schedule E rows as the targeting line; not a judgement.
 */
function targetedSide(s: OutsideSpender, candidates: RaceCandidate[]): Party | null {
  const partyOf = new Map(candidates.map((c) => [c.candidate_id, c.party]));
  const parties = [...new Set(candidates.map((c) => c.party))];
  const score = new Map<Party, number>();
  for (const row of s.by_candidate) {
    const p = partyOf.get(row.candidate_id);
    if (!p) continue;
    if (row.support_oppose === "S") score.set(p, (score.get(p) ?? 0) + row.amount);
    else if (parties.length === 2) {
      const other = parties.find((q) => q !== p);
      if (other) score.set(other, (score.get(other) ?? 0) + row.amount);
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}

/** "What does this group say it is for?" — the kind, plus which side its declared targeting lands on for partisan platforms. */
function focusHeadline(focus: IssueFocus, side: Party | null): string {
  const head = FOCUS_KIND_HEADLINES[focus.kind];
  return focus.kind === "general_partisan" && side ? `${head} · ${PARTY_SIDE[side]} side in this race` : head;
}

function SpenderCard({
  model,
  raceId,
  candidates,
  lastName,
}: {
  model: CardModel;
  raceId: string;
  candidates: RaceCandidate[];
  lastName: Map<string, string>;
}) {
  const router = useRouter();
  const { spender: s, story, focus } = model;
  const href = routes.entity(raceId, s.entity_id);
  const dark = darkShare(s);
  const focusSource = focus?.basis.source_urls[0];
  const side = focus?.kind === "general_partisan" ? targetedSide(s, candidates) : null;

  // Whole card navigates; real links/buttons/disclosures inside keep their own behaviour, and text selection is left alone.
  const onCardClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a, button, summary")) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noreferrer");
    else router.push(href);
  };

  return (
    <article className="spender-card" onClick={onCardClick} data-entity={s.entity_id}>
      <div className="spender-card-head">
        <h3 className="spender-card-title">
          <Link href={href} className="spender-card-link">
            {displayName(s.name)}
          </Link>
        </h3>
        <div className="spender-card-type">{s.committee_type_label}</div>
        {(isVerified(story) || s.flags.length > 0) && (
          <div className="spender-card-chips">
            {isVerified(story) && (
              <Chip tone="green" title="A human checked the chain against the linked fec.gov record">
                Checked against fec.gov
              </Chip>
            )}
            {s.flags.map((f) => (
              <FlagBadge key={f} flag={f} />
            ))}
          </div>
        )}
      </div>

      <div className="spender-card-numbers">
        <div className="spender-card-stat">
          <div className="spender-card-big">
            <Money amount={s.total} />
          </div>
          <div className="spender-card-caption">
            independent expenditures · <SourceLink href={s.source_url} label="FEC" />
          </div>
        </div>
        <div className="spender-card-stat">
          {dark ? (
            <>
              <div className="spender-card-big spender-card-dark">{pct(dark.share)}</div>
              <div className="spender-card-caption">{dark.exact ? "of traced receipts is dark (undisclosed)" : "of traced receipts not traced to a disclosed source"}</div>
            </>
          ) : (
            <>
              <div className="spender-card-big text-neutral-400">—</div>
              <div className="spender-card-caption">dark share not computed · no receipts to walk</div>
            </>
          )}
        </div>
      </div>
      {dark && (
        <StackedBar
          segments={[
            { label: "Dark", value: dark.share, color: VISIBILITY_COLORS.dark },
            { label: dark.exact ? "Disclosed, inferable, or not walked" : "Traced", value: 1 - dark.share, color: "#e5e5e5" },
          ]}
          height="h-1.5"
        />
      )}

      <p className="spender-card-targets">{targetingLine(s, lastName) || "No per-candidate rows on file"}</p>

      {focus && (
        <div className="spender-card-agenda">
          <span className="spender-card-agenda-label">Self-described focus</span>
          <p className="spender-card-agenda-head">
            {focusHeadline(focus, side)}
            {focusSource && (
              <>
                {" "}
                <SourceLink href={focusSource} label="source" />
              </>
            )}
          </p>
          {focus.issue_ids.length > 0 && (
            <ul className="spender-card-agenda-issues" aria-label="Tagged issues">
              {focus.issue_ids.map((id) => (
                <li key={id} title={ISSUE_BY_ID[id].description}>
                  {ISSUE_BY_ID[id].label}
                </li>
              ))}
            </ul>
          )}
          <details className="spender-card-agenda-quote">
            <summary>In its own words</summary>
            <p>“{focus.description}”</p>
          </details>
        </div>
      )}

      <div className="spender-card-foot">
        <Link href={href} className="hover:underline">
          Entity page →
        </Link>
        {s.has_chain && (
          <Link href={routes.chain(raceId, s.entity_id)} className="hover:underline">
            Funding chain →
          </Link>
        )}
      </div>
    </article>
  );
}

export function SpenderCards({
  raceId,
  spenders,
  candidates,
  stories,
  focus,
}: {
  raceId: string;
  spenders: OutsideSpender[];
  candidates: RaceCandidate[];
  stories: Story[];
  /** entity_id → hand-tagged issue focus, read server-side from entities/<id>.json. */
  focus: Record<string, IssueFocus>;
}) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [category, setCategory] = useState<CategoryKey>("all");

  const lastName = useMemo(() => new Map(candidates.map((c) => [c.candidate_id, c.name.split(" ").at(-1) ?? c.name])), [candidates]);

  const models = useMemo<CardModel[]>(() => {
    const storyByRoot = new Map<string, Story>();
    for (const st of stories) if (!storyByRoot.has(st.root_entity_id)) storyByRoot.set(st.root_entity_id, st);
    return [...spenders]
      .sort((a, b) => b.total - a.total)
      .map((s) => {
        const story = storyByRoot.get(s.entity_id) ?? null;
        const f = focus[s.entity_id] ?? null;
        const cats = new Set<CategoryKey>();
        if (story) cats.add(`highlight:${story.kind}`);
        for (const fl of s.flags) cats.add(`flag:${fl}`);
        if (f) cats.add(`focus:${f.kind}`);
        return { spender: s, story, focus: f, categories: cats };
      });
  }, [spenders, stories, focus]);

  const groups = useMemo(() => {
    const present = new Set<CategoryKey>();
    for (const m of models) for (const c of m.categories) present.add(c);
    const pick = <K extends string>(prefix: string, ids: readonly K[], labels: Record<K, string>, meanings: Record<K, string>): Category[] =>
      ids.filter((id) => present.has(`${prefix}:${id}` as CategoryKey)).map((id) => ({ key: `${prefix}:${id}` as CategoryKey, label: labels[id], meaning: meanings[id] }));
    return [
      { name: "Highlight", options: pick("highlight", Object.keys(STORY_KIND_LABELS) as StoryKind[], STORY_KIND_LABELS, STORY_KIND_MEANINGS) },
      { name: "Flag", options: pick("flag", Object.keys(FLAG_LABELS) as FlagId[], FLAG_LABELS, FLAG_MEANINGS) },
      { name: "Self-described focus", options: pick("focus", FOCUS_KINDS, FOCUS_KIND_LABELS, FOCUS_KIND_MEANINGS) },
    ].filter((g) => g.options.length > 0);
  }, [models]);

  const selected = groups.flatMap((g) => g.options).find((o) => o.key === category) ?? null;
  const shown = selected ? models.filter((m) => m.categories.has(selected.key)) : models;
  const shownTotal = shown.reduce((acc, m) => acc + m.spender.total, 0);

  return (
    <div className="spender-cards">
      <div className="spender-toolbar">
        <div className="spender-toolbar-filter">
          <label htmlFor="spender-category" className="text-xs text-neutral-600">
            Category
          </label>
          <select id="spender-category" className="spender-select" value={category} onChange={(e) => setCategory(e.target.value as CategoryKey)}>
            <option value="all">All spenders</option>
            {groups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="spender-toolbar-view" role="group" aria-label="View">
          <button type="button" className="spender-view-btn" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
            Cards
          </button>
          <button type="button" className="spender-view-btn" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Table
          </button>
        </div>
      </div>
      <p className="spender-toolbar-note">
        {selected ? (
          <>
            <strong>{selected.label}</strong> — {selected.meaning}{" "}
          </>
        ) : (
          <>Every committee reporting independent expenditures about candidates in this race, largest first. </>
        )}
        <span className="text-neutral-500">
          {shown.length} of {models.length} spenders · <Money amount={shownTotal} />
        </span>
      </p>

      {view === "cards" ? (
        shown.length > 0 ? (
          <div className="spender-grid">
            {shown.map((m) => (
              <SpenderCard key={m.spender.entity_id} model={m} raceId={raceId} candidates={candidates} lastName={lastName} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No spenders in this category.</p>
        )
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-600">
            S = supports, O = opposes, as declared by the spender. Independent expenditures are targeting records; they are not money to a campaign.
          </p>
          <SpendersTable raceId={raceId} spenders={shown.map((m) => m.spender)} candidates={candidates} />
          {shown.some((m) => m.spender.flags.length > 0) && (
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-500">Flags</div>
              <FlagsLegend flags={shown.flatMap((m) => m.spender.flags)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

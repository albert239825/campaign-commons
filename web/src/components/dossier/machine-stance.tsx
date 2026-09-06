import type { IssueId, MachineStance as MachineStanceRow } from "@campaign-commons/contracts";
import { Chip, SourceLink, type ChipTone } from "@/components/ui";
import { directionLabel } from "@/lib/alignment";
import { date } from "@/lib/format";

const CONFIDENCE_TONE: Record<MachineStanceRow["confidence"], ChipTone> = { high: "green", medium: "amber", low: "muted" };

function splitSummary(summary: string): { lead: string; rest: string | null } {
  if (summary.length <= 240) return { lead: summary, rest: null };
  const match = /(?:\.(?:”)?)(?=\s+[A-Z])/.exec(summary);
  if (!match || match.index === undefined) return { lead: summary, rest: null };
  const end = match.index + match[0].length;
  const lead = summary.slice(0, end);
  const rest = summary.slice(end).trim();
  return rest ? { lead, rest } : { lead: summary, rest: null };
}

function hostname(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function sourceKind(url: string): "official" | "news / web" {
  return hostname(url).endsWith(".gov") ? "official" : "news / web";
}

function provenanceDate(stance: MachineStanceRow): string {
  const value = stance.provenance.tagged_at || stance.provenance.retrieved_at;
  return value ? date(value.slice(0, 10)) : stance.label;
}

export function MachineStance({ issueId, stance }: { issueId: IssueId; stance: MachineStanceRow }) {
  const status = stance.provenance.review_status;
  const { lead, rest } = splitSummary(stance.summary);
  const verifiedSources = stance.sources.filter((source) => source.excerpt_verified).length;
  const visiblePosts = stance.posts.slice(0, 3);
  const remainingPosts = stance.posts.slice(3);
  return (
    <div className="machine-stance">
      <div className="machine-head">Machine summary · not part of the record</div>
      <div className="machine-position">
        <p className="machine-summary">{lead}</p>
        {rest && (
          <details className="policies-evidence-more">
            <summary>
              <span className="policies-evidence-more-closed">Show full summary</span>
              <span className="policies-evidence-more-open">Full summary</span>
            </summary>
            <p className="machine-summary">{rest}</p>
          </details>
        )}
        <div className="flex flex-wrap gap-1">
          <Chip tone={CONFIDENCE_TONE[stance.confidence]} title="Model-reported confidence in the summary">
            {stance.confidence} confidence
          </Chip>
          {stance.direction_proposed !== null && (
            <Chip tone="muted" title="Direction proposed by the model against the issue axis; an inference, not a coded position">
              proposed: {directionLabel(issueId, stance.direction_proposed)}
            </Chip>
          )}
        </div>
      </div>

      <div className="machine-list-head">
        Sources · {stance.sources.length} {stance.sources.length === 1 ? "page" : "pages"}
      </div>
      <ol className="evidence-list divide-y divide-neutral-100">
        {stance.sources.map((s) => (
          <li key={s.url} className="grid gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[7.5rem_1fr_auto]">
            <div className="flex flex-col items-start gap-2">
              <Chip tone={sourceKind(s.url) === "official" ? "neutral" : "muted"}>{sourceKind(s.url)}</Chip>
              {!s.excerpt_verified && (
                <Chip tone="amber" title="The page could not be fetched to confirm this excerpt">
                  unverified excerpt
                </Chip>
              )}
            </div>
            <div className="min-w-0">
              <div className="font-medium leading-snug">{s.publisher}</div>
              <div className="text-xs text-neutral-500">{s.published_on ? date(s.published_on) : "—"}</div>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">“{s.excerpt}”</p>
            </div>
            <div className="sm:text-right">
              <SourceLink href={s.url} label={hostname(s.url)} />
              {s.wayback_url && <SourceLink href={s.wayback_url} label="archived" className="ml-3" />}
            </div>
          </li>
        ))}
      </ol>
      {stance.posts.length > 0 && (
        <>
          <div className="machine-list-head">In their own words · {stance.posts.length} verified X posts</div>
          <ol className="evidence-list divide-y divide-neutral-100">
            {visiblePosts.map((p) => (
              <li key={p.url} className="grid gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[7.5rem_1fr_auto]">
                <div className="flex flex-col items-start gap-2">
                  <Chip tone="muted">X post</Chip>
                </div>
                <div className="min-w-0">
                  <div className="font-medium leading-snug">{p.excerpt}</div>
                  <div className="text-xs text-neutral-500">{p.posted_on ? date(p.posted_on) : "—"}</div>
                </div>
                <div className="sm:text-right">
                  <SourceLink href={p.url} label="x.com" />
                </div>
              </li>
            ))}
          </ol>
          {remainingPosts.length > 0 && (
            <details className="policies-evidence-more">
              <summary>
                <span className="policies-evidence-more-closed">Show all {stance.posts.length} posts</span>
                <span className="policies-evidence-more-open">Showing all {stance.posts.length} posts</span>
              </summary>
              <ol className="evidence-list divide-y divide-neutral-100">
                {remainingPosts.map((p) => (
                  <li key={p.url} className="grid gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[7.5rem_1fr_auto]">
                    <div className="flex flex-col items-start gap-2">
                      <Chip tone="muted">X post</Chip>
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium leading-snug">{p.excerpt}</div>
                      <div className="text-xs text-neutral-500">{p.posted_on ? date(p.posted_on) : "—"}</div>
                    </div>
                    <div className="sm:text-right">
                      <SourceLink href={p.url} label="x.com" />
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      <p className="machine-provenance">
        {stance.provenance.model} · {provenanceDate(stance)} · {verifiedSources} of {stance.sources.length} excerpts verified ·{" "}
        {stance.posts.length} posts verified · {status === "accepted" ? "human-accepted" : "pending review"}
      </p>
    </div>
  );
}

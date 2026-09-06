import type { IssueId, MachineStance as MachineStanceRow } from "@campaign-commons/contracts";
import { Chip, type ChipTone } from "@/components/ui";
import { directionLabel } from "@/lib/alignment";
import { date } from "@/lib/format";

const CONFIDENCE_TONE: Record<MachineStanceRow["confidence"], ChipTone> = { high: "green", medium: "amber", low: "muted" };

export function MachineStance({ issueId, stance }: { issueId: IssueId; stance: MachineStanceRow }) {
  const status = stance.provenance.review_status;
  return (
    <div className="machine-stance mt-3 rounded-md border border-dashed border-violet-300 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-xs uppercase tracking-wide text-violet-700">Machine-summarised · not part of the record</div>
        <div className="flex gap-1">
          <Chip tone={CONFIDENCE_TONE[stance.confidence]} title="Model-reported confidence in the summary">
            {stance.confidence} confidence
          </Chip>
          {stance.direction_proposed !== null && (
            <Chip tone="muted" title="Direction proposed by the model against the issue axis; an inference, not a coded position">
              proposed: {directionLabel(issueId, stance.direction_proposed)}
            </Chip>
          )}
          <Chip tone={status === "accepted" ? "green" : "amber"} title="Human review status of this machine row">
            {status === "accepted" ? "human-accepted" : "pending review"}
          </Chip>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{stance.summary}</p>
      <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
        Sources · {stance.sources.length} {stance.sources.length === 1 ? "page" : "pages"}
      </div>
      <ul className="mt-1 space-y-2">
        {stance.sources.map((s) => (
          <li key={s.url} className="text-sm">
            <a href={s.url} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900" target="_blank" rel="noreferrer">
              {s.publisher}
            </a>
            {s.published_on && <span className="text-xs text-neutral-500"> · {date(s.published_on)}</span>}
            {!s.excerpt_verified && (
              <Chip tone="amber" className="ml-1" title="The page could not be fetched to confirm this excerpt">unverified excerpt</Chip>
            )}
            <blockquote className="mt-0.5 border-l-2 border-neutral-200 pl-2 text-sm text-neutral-700">“{s.excerpt}”</blockquote>
          </li>
        ))}
      </ul>
      {stance.posts.length > 0 && (
        <>
          <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">In their own words · {stance.posts.length} verified X posts</div>
          <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
            {stance.posts.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="w-64 shrink-0 rounded border border-neutral-200 bg-white p-2 text-xs leading-relaxed hover:border-neutral-400"
              >
                <p className="text-neutral-800">{p.excerpt}</p>
                <p className="mt-1 text-neutral-500">{p.posted_on ? date(p.posted_on) : "x.com"} →</p>
              </a>
            ))}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] text-neutral-500">{stance.label}</p>
    </div>
  );
}

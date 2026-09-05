import Link from "next/link";
import { VISIBILITY_COLORS, type Story } from "@citizen-gotham/contracts";
import { pct, routes } from "@/lib/format";
import { Chip, Money, SourceLink } from "@/components/ui";
import { StackedBar } from "@/components/ui/stacked-bar";

const KIND_LABELS: Record<Story["kind"], string> = {
  biggest_spender: "Biggest spender",
  dark_dead_end: "Dark wall",
  popup: "Pop-up committee",
  single_transfer: "One source",
  ad_to_chain: "Ad → chain",
};

/** First sentence of the templated narrative; the full text lives on the stories page. */
const firstSentence = (s: string) => s.split(/(?<=\.)\s+/)[0] ?? s;

export function VerificationChip({ story }: { story: Story }) {
  if (story.verified && story.verified_by_url) {
    return (
      <Chip tone="green" title="A human checked the chain against the linked fec.gov record">
        Checked against fec.gov
      </Chip>
    );
  }
  return null;
}

export function StoryCard({ story, raceId, hasChain, full = false, expandable = false }: { story: Story; raceId: string; hasChain: boolean; full?: boolean; expandable?: boolean }) {
  const { amount, dark_share } = story.headline_numbers;
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">{KIND_LABELS[story.kind]}</span>
        <VerificationChip story={story} />
      </div>
      <h3 className="text-sm font-semibold leading-tight">{story.title}</h3>
      <div className="text-xl font-semibold tabular-nums">
        <Money amount={amount} />
        <span className="ml-1 text-xs font-normal text-neutral-500">independent expenditures</span>
      </div>
      {dark_share !== null && (
        <div>
          <div className="mb-0.5 text-[11px] text-neutral-500">Dark share of traced receipts · {pct(dark_share)}</div>
          <StackedBar
            segments={[
              { label: "Dark", value: dark_share, color: VISIBILITY_COLORS.dark },
              { label: "Disclosed or not walked", value: 1 - dark_share, color: "#d4d4d4" },
            ]}
          />
        </div>
      )}
      <p className="text-xs leading-relaxed text-neutral-700">{full ? story.narrative : firstSentence(story.narrative)}</p>
      {expandable && !full && (
        <details className="story-narrative">
          <summary>Read full story</summary>
          <p>{story.narrative}</p>
        </details>
      )}
      <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-2 text-xs">
        <Link href={routes.entity(raceId, story.root_entity_id)} className="font-medium text-neutral-900 hover:underline">
          Entity
        </Link>
        {hasChain && (
          <Link href={routes.chain(raceId, story.root_entity_id)} className="font-medium text-neutral-900 hover:underline">
            Funding chain →
          </Link>
        )}
        {story.verified_by_url && <SourceLink href={story.verified_by_url} label="fec.gov record" />}
      </footer>
    </article>
  );
}

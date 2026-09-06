import { DetailHeader } from "@/components/ui/detail-layout";
import { getRace, getStories, hasChain, listRaceIds } from "@/lib/data";
import { date } from "@/lib/format";
import { AdjacencyNote } from "@/components/ui";
import { StoryCard } from "@/components/ledger/story-card";
import { RaceShell } from "@/components/ui/race-shell";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function StoriesPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const stories = getStories(raceId);
  const verified = stories.stories.filter((s) => s.verified && s.verified_by_url).length;

  return (
    <RaceShell
      race={race}
      section="stories"
      status={stories.data_status}
      crumbs={[{ label: "Stories" }]}
      className="stories-page"
      header={
        <DetailHeader label={race.label} title="Funding highlights">
          <p className="max-w-3xl text-sm text-neutral-600">
            {stories.stories.length} outside spenders the pipeline ranked as worth a look: the largest by independent expenditures, the largest whose
            funding chain stops at a dark wall, and every committee carrying a pop-up or single-source flag. Titles and narratives are templated from the
            chain data; {verified} of {stories.stories.length} have been checked by a person against fec.gov.
          </p>
        </DetailHeader>
      }
    >
      {stories.stories.length === 0 && <p className="detail-empty">No funding highlights are available for this race yet.</p>}
      <div className="detail-stories-grid">
        {stories.stories.map((s) => (
          <StoryCard key={s.story_id} story={s} raceId={raceId} hasChain={hasChain(raceId, s.root_entity_id)} full />
        ))}
      </div>
      <footer className="space-y-2 border-t border-neutral-200 pt-4">
        <AdjacencyNote />
        <p className="text-xs text-neutral-500">Generated {date(stories.generated_at.slice(0, 10))}.</p>
      </footer>
    </RaceShell>
  );
}

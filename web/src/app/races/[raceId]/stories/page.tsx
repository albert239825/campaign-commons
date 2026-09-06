import { DetailHeader } from "@/components/ui/detail-layout";
import { getAds, getRace, getStories, hasChain, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, DataStatusBanner } from "@/components/ui";
import { StoryCard } from "@/components/ledger/story-card";
import { RaceNav } from "@/components/ui/race-nav";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function StoriesPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const stories = getStories(raceId);
  const verified = stories.stories.filter((s) => s.verified && s.verified_by_url).length;

  return (
    <div className="detail-page stories-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Stories" }]} />
      <DataStatusBanner status={stories.data_status} />
      <DetailHeader label={race.label} title="Funding highlights">
        <p className="max-w-3xl text-sm text-neutral-600">
          {stories.stories.length} outside spenders the pipeline ranked as worth a look: the largest by independent expenditures, the largest whose
          funding chain stops at a dark wall, and every committee carrying a pop-up or single-source flag. Titles and narratives are templated from the
          chain data; {verified} of {stories.stories.length} have been checked by a person against fec.gov.
        </p>
      </DetailHeader>
      <RaceNav race={race} counts={{ ads: getAds(raceId).ads.length }} />
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
    </div>
  );
}

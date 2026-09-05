// OWNER: Money Trails (D-73).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRace, getTrails, hasTrails, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";
import { canonicalQuestion, INTENT_LABELS, INTENTS } from "@/lib/ask";
import { Breadcrumbs, Card, DataStatusBanner } from "@/components/ui";
import { AskBox, SuggestionLink } from "@/components/ask/ask-box";

export const generateStaticParams = () => listRaceIds().filter(hasTrails).map((raceId) => ({ raceId }));

export default async function AskPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  if (!hasTrails(raceId)) notFound();
  const trails = getTrails(raceId);
  const candidates = trails.subjects.filter((s) => s.kind === "candidate");
  const committees = trails.subjects.filter((s) => s.kind === "committee");

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Money Trails" }]} />
      <DataStatusBanner status={trails.data_status} />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Money Trails · {race.label}</h1>
        <p className="max-w-3xl text-sm text-neutral-600">
          Ask a plain-English money question about this race. Three kinds are answered, each from the filed records already on this site;
          nothing is generated, and every number links to where it was read.
        </p>
      </header>

      <Card>
        <AskBox raceId={raceId} subjects={trails.subjects} examples={trails.examples} autoFocus />
        <ul className="mt-3 flex flex-wrap gap-2">
          {trails.examples.map((q) => (
            <li key={q}>
              <SuggestionLink raceId={raceId} subjects={trails.subjects} question={q} />
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {INTENTS.map((intent) => {
          const subjects = intent === "committee_funding" ? committees : candidates;
          return (
            <Card key={intent} title={INTENT_LABELS[intent]}>
              <ul className="space-y-1 text-sm">
                {subjects.slice(0, intent === "committee_funding" ? 12 : subjects.length).map((s) => (
                  <li key={s.id}>
                    <Link href={routes.answer(raceId, intent, s.id)} className="hover:underline">
                      {canonicalQuestion(intent, s)}
                    </Link>
                  </li>
                ))}
                {intent === "committee_funding" && committees.length > 12 && (
                  <li className="text-xs text-neutral-500">…and {committees.length - 12} more committees on the ledger; type a name.</li>
                )}
              </ul>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-neutral-500">{trails.method}</p>
    </div>
  );
}

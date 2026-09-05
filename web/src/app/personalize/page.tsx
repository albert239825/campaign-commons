import type { Metadata } from "next";
import type { Dossier } from "@citizen-gotham/contracts";
import { getDossier, getRaces, listDossierIds, listRaceIds } from "@/lib/data";
import { PersonalizeClient } from "@/components/personalize/personalize-client";

export const metadata: Metadata = {
  title: "Personalize · Citizen Gotham",
  description: "Create a private alignment estimate from your stated issue positions.",
};

export default function PersonalizePage() {
  const raceIndex = getRaces();
  const dataRaces = new Set(listRaceIds());
  const races = raceIndex.races.filter((race) => dataRaces.has(race.race_id) && listDossierIds(race.race_id).length > 0);
  const dossiers: Dossier[] = races.flatMap((race) => {
    const candidateIds = new Set(race.candidates.map((candidate) => candidate.candidate_id));
    return listDossierIds(race.race_id)
      .filter((candidateId) => candidateIds.has(candidateId))
      .map((candidateId) => getDossier(race.race_id, candidateId));
  });
  return <PersonalizeClient races={races} dossiers={dossiers} />;
}

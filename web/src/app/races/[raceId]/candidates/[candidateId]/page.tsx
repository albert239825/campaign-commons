// OWNER: Frontend B (candidate dossier).
import { notFound, permanentRedirect } from "next/navigation";
import { listDossierIds, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";

export const generateStaticParams = () =>
  listRaceIds().flatMap((raceId) => listDossierIds(raceId).map((candidateId) => ({ raceId, candidateId })));

/** Per-candidate dossiers were folded into the race's Stances page; keep the old address working. */
export default async function DossierPage({ params }: { params: Promise<{ raceId: string; candidateId: string }> }) {
  const { raceId, candidateId } = await params;
  if (!listDossierIds(raceId).includes(candidateId)) notFound();
  permanentRedirect(routes.stances(raceId));
}

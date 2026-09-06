/**
 * The only place the web app touches the filesystem. Server components call these;
 * every loader validates against the contract so a bad pipeline output fails loudly at build.
 *
 * All functions are synchronous file reads of data/out/ — cheap, and they make
 * generateStaticParams trivial.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import type { ZodTypeAny, z } from "zod";
import {
  AdGallerySchema,
  ChainSchema,
  DonorViewSchema,
  DossierSchema,
  EntitySchema,
  IssueSpendingSchema,
  LedgerSchema,
  RacesIndexSchema,
  SearchIndexSchema,
  StoriesSchema,
  VendorIndexSchema,
  VendorSchema,
} from "@campaign-commons/contracts";

const DATA_OUT = process.env.GOTHAM_DATA_DIR ?? join(process.cwd(), "..", "data", "out");

function load<S extends ZodTypeAny>(schema: S, ...segments: string[]): z.infer<S> {
  const file = join(DATA_OUT, ...segments);
  if (!existsSync(file)) notFound();
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`Contract violation in ${segments.join("/")}:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}

function listIds(...segments: string[]): string[] {
  const dir = join(DATA_OUT, ...segments);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

export const getRaces = () => load(RacesIndexSchema, "races.json");
export const getRace = (raceId: string) => {
  const race = getRaces().races.find((r) => r.race_id === raceId);
  if (!race) notFound();
  return race;
};
export const getLedger = (raceId: string) => load(LedgerSchema, raceId, "ledger.json");
export const getEntity = (raceId: string, entityId: string) => load(EntitySchema, raceId, "entities", `${entityId}.json`);
export const getChain = (raceId: string, entityId: string) => load(ChainSchema, raceId, "chains", `${entityId}.json`);
export const getAds = (raceId: string) => load(AdGallerySchema, raceId, "ads.json");
/** Ads grouped by matched sponsor committee; memoised per race because every entity and donor page asks. */
const adsBySponsorCache = new Map<string, Map<string, z.infer<typeof AdGallerySchema>["ads"]>>();
export const getAdsBySponsor = (raceId: string) => {
  const cached = adsBySponsorCache.get(raceId);
  if (cached) return cached;
  const grouped = new Map<string, z.infer<typeof AdGallerySchema>["ads"]>();
  const file = join(DATA_OUT, raceId, "ads.json");
  if (existsSync(file)) {
    for (const ad of getAds(raceId).ads) {
      if (ad.matched_entity_id === null) continue;
      grouped.set(ad.matched_entity_id, [...(grouped.get(ad.matched_entity_id) ?? []), ad]);
    }
  }
  adsBySponsorCache.set(raceId, grouped);
  return grouped;
};
export const getDossier = (raceId: string, candidateId: string) =>
  load(DossierSchema, raceId, "dossiers", `${candidateId}.json`);
export const getStories = (raceId: string) => load(StoriesSchema, raceId, "stories.json");
export const getDonor = (raceId: string, donorKey: string) => load(DonorViewSchema, raceId, "donors", `${donorKey}.json`);
export const getVendors = (raceId: string) => load(VendorIndexSchema, raceId, "vendors.json");
export const getVendor = (raceId: string, vendorId: string) => load(VendorSchema, raceId, "vendors", `${vendorId}.json`);
/** Cross-race client index (`make search`); served to the browser by app/search.json/route.ts. */
export const getSearchIndex = () => load(SearchIndexSchema, "search.json");
/** Block 2 issue layers; null when the stage has not run so the ledger still builds. */
export const getIssues = (raceId: string) =>
  existsSync(join(DATA_OUT, raceId, "issues.json")) ? load(IssueSpendingSchema, raceId, "issues.json") : null;

/** Race ids that have a data directory (stub races have none). */
export const listRaceIds = () => getRaces().races.filter((r) => existsSync(join(DATA_OUT, r.race_id))).map((r) => r.race_id);
export const listEntityIds = (raceId: string) => listIds(raceId, "entities");
export const listChainIds = (raceId: string) => listIds(raceId, "chains");
export const listDossierIds = (raceId: string) => listIds(raceId, "dossiers");
export const listDonorKeys = (raceId: string) => listIds(raceId, "donors");
export const listVendorIds = (raceId: string) => listIds(raceId, "vendors");
/** Vendor count for nav tabs; 0 when the vendors stage has not run for this race. */
export const countVendors = (raceId: string) => (existsSync(join(DATA_OUT, raceId, "vendors.json")) ? getVendors(raceId).vendors.length : 0);
export const hasChain = (raceId: string, entityId: string) => existsSync(join(DATA_OUT, raceId, "chains", `${entityId}.json`));
/** Hand-tagged self-described focus (D-66) for one entity; null when the entity file or the tag is absent. */
export const getIssueFocus = (raceId: string, entityId: string) =>
  existsSync(join(DATA_OUT, raceId, "entities", `${entityId}.json`)) ? (getEntity(raceId, entityId).issue_focus ?? null) : null;
export const hasEntity = (raceId: string, entityId: string) => existsSync(join(DATA_OUT, raceId, "entities", `${entityId}.json`));
export const hasDossier = (raceId: string, candidateId: string) => existsSync(join(DATA_OUT, raceId, "dossiers", `${candidateId}.json`));

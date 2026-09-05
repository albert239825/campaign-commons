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
  LedgerSchema,
  RacesIndexSchema,
  StoriesSchema,
  TrailsSchema,
} from "@citizen-gotham/contracts";

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
export const getDossier = (raceId: string, candidateId: string) =>
  load(DossierSchema, raceId, "dossiers", `${candidateId}.json`);
export const getStories = (raceId: string) => load(StoriesSchema, raceId, "stories.json");
export const getDonor = (raceId: string, donorKey: string) => load(DonorViewSchema, raceId, "donors", `${donorKey}.json`);
export const getTrails = (raceId: string) => load(TrailsSchema, raceId, "trails.json");
export const hasTrails = (raceId: string) => existsSync(join(DATA_OUT, raceId, "trails.json"));

/** Race ids that have a data directory (stub races have none). */
export const listRaceIds = () => getRaces().races.filter((r) => existsSync(join(DATA_OUT, r.race_id))).map((r) => r.race_id);
export const listEntityIds = (raceId: string) => listIds(raceId, "entities");
export const listChainIds = (raceId: string) => listIds(raceId, "chains");
export const listDossierIds = (raceId: string) => listIds(raceId, "dossiers");
export const listDonorKeys = (raceId: string) => listIds(raceId, "donors");
export const hasChain = (raceId: string, entityId: string) => existsSync(join(DATA_OUT, raceId, "chains", `${entityId}.json`));

/**
 * Load one race's published artifacts (chains, entities, donors, ads, ledger, trails) into Neo4j (D-77). Idempotent: nodes and edges are MERGEd on their keys, so re-running
 * after a pipeline regenerate updates in place; pass --reset to drop the race's subgraph first.
 *
 *   cd web && node --env-file=.env.local --import tsx scripts/load-graph.ts pa-sen-2024 [--reset]
 *
 * Reads NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD (and GOTHAM_DATA_DIR, like the site). Every chain is validated
 * against the contract before anything is written; a contract violation aborts the load.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AdGallerySchema,
  ChainSchema,
  DonorViewSchema,
  EntitySchema,
  LedgerSchema,
  TrailsSchema,
  type AdGallery,
  type Chain,
  type DonorView,
  type Entity,
  type Ledger,
  type Trails,
} from "@campaign-commons/contracts";
import type { ZodType } from "zod";
import { createDriver, graphConfig } from "../src/lib/graph/neo4j";
import { ENTITY, REL, graphRows, type GraphEdgeRow } from "../src/lib/graph/schema";

const DATA_OUT = process.env.GOTHAM_DATA_DIR ?? join(process.cwd(), "..", "data", "out");
const BATCH = 2000;

function readJson<T>(schema: ZodType<T>, ...rel: string[]): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(join(DATA_OUT, ...rel), "utf8")));
  if (!parsed.success) throw new Error(`contract violation in ${rel.join("/")}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

function readDir<T>(schema: ZodType<T>, raceId: string, sub: string): T[] {
  const dir = join(DATA_OUT, raceId, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(schema, raceId, sub, f));
}

function* batches<T>(rows: readonly T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += BATCH) yield rows.slice(i, i + BATCH);
}

async function main() {
  const [raceId, ...flags] = process.argv.slice(2);
  if (!raceId) throw new Error("usage: load-graph.ts <race_id> [--reset]");
  const cfg = graphConfig();
  if (!cfg) throw new Error("NEO4J_URI is not set");

  const chains: Chain[] = readDir(ChainSchema, raceId, "chains");
  if (chains.length === 0) throw new Error(`no chains under ${join(DATA_OUT, raceId, "chains")}`);
  const entities: Entity[] = readDir(EntitySchema, raceId, "entities");
  const donors: DonorView[] = readDir(DonorViewSchema, raceId, "donors");
  const ledger: Ledger = readJson(LedgerSchema, raceId, "ledger.json");
  const trails: Trails = readJson(TrailsSchema, raceId, "trails.json");
  const gallery: AdGallery = readJson(AdGallerySchema, raceId, "ads.json");
  const { nodes, edges } = graphRows({ raceId, chains, ledger, trails, entities, donors, ads: gallery.ads });
  console.log(
    `${raceId}: ${chains.length} chains, ${entities.length} entities, ${donors.length} donors, ${gallery.ads.length} ads → ${nodes.length} nodes, ${edges.length} edges`,
  );

  const driver = createDriver(cfg);
  const run = (cypher: string, params: Record<string, unknown> = {}) =>
    driver.executeQuery(cypher, params, { database: cfg.database, routing: "WRITE" });
  try {
    await run(`CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:${ENTITY}) REQUIRE (e.race_id, e.id) IS UNIQUE`);
    await run(`CREATE INDEX entity_name IF NOT EXISTS FOR (e:${ENTITY}) ON (e.race_id, e.name_lc)`);
    await run(`CREATE INDEX entity_kind IF NOT EXISTS FOR (e:${ENTITY}) ON (e.race_id, e.kind)`);

    if (flags.includes("--reset")) {
      await run(`MATCH (e:${ENTITY} {race_id: $race}) DETACH DELETE e`, { race: raceId });
      console.log("reset: dropped existing subgraph");
    }

    for (const rows of batches(nodes)) {
      await run(
        `UNWIND $rows AS n
         MERGE (e:${ENTITY} {race_id: $race, id: n.id})
         SET e.name = n.name, e.name_lc = n.name_lc, e.kind = n.kind, e.committee_type = n.committee_type,
             e.visibility = n.visibility, e.source_url = n.source_url, e.href = n.href`,
        { race: raceId, rows },
      );
    }

    const byType = new Map<string, GraphEdgeRow[]>();
    for (const e of edges) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    for (const type of Object.values(REL)) {
      for (const rows of batches(byType.get(type) ?? [])) {
        await run(
          `UNWIND $rows AS r
           MATCH (a:${ENTITY} {race_id: $race, id: r.from}), (b:${ENTITY} {race_id: $race, id: r.to})
           MERGE (a)-[x:${type} {key: r.key}]->(b)
           SET x.amount = r.amount, x.count = r.count, x.visibility = r.visibility, x.transaction_types = r.transaction_types,
               x.first_date = r.first_date, x.last_date = r.last_date, x.support_oppose = r.support_oppose, x.basis = r.basis,
               x.source_url = r.source_url, x.chains = r.chains`,
          { race: raceId, rows },
        );
      }
    }

    const { records } = await run(
      `MATCH (e:${ENTITY} {race_id: $race}) WITH count(e) AS nodes
       MATCH (:${ENTITY} {race_id: $race})-[r]->(:${ENTITY} {race_id: $race}) RETURN nodes, type(r) AS type, count(r) AS edges`,
      { race: raceId },
    );
    for (const r of records) console.log(`  ${String(r.get("type")).padEnd(12)} ${r.get("edges")} edges (nodes: ${r.get("nodes")})`);
  } finally {
    await driver.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

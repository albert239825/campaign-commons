/**
 * Neo4j connection for the Money Trails graph (D-77). Server-only: reads NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD.
 * With no URI configured the graph is simply "not available" and the ask endpoint says so; nothing else in the site
 * depends on it. One driver per process (per warm function instance on Vercel), created lazily.
 */
import neo4j, { type Driver } from "neo4j-driver";

export type GraphConfig = { uri: string; user: string; password: string; database?: string };

export function graphConfig(env: Record<string, string | undefined> = process.env): GraphConfig | null {
  const uri = env.NEO4J_URI?.trim();
  if (!uri) return null;
  return {
    uri,
    user: env.NEO4J_USER?.trim() || "neo4j",
    password: env.NEO4J_PASSWORD ?? "",
    database: env.NEO4J_DATABASE?.trim() || undefined,
  };
}

export function createDriver(cfg: GraphConfig): Driver {
  return neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.password), {
    // amounts and counts come back as plain JS numbers (they are far below 2^53)
    disableLosslessIntegers: true,
    connectionAcquisitionTimeout: 5_000,
    maxConnectionPoolSize: 10,
  });
}

let shared: { driver: Driver; database?: string } | null = null;

/** The process-wide driver, or null when NEO4J_URI is not set. */
export function getDriver(): { driver: Driver; database?: string } | null {
  if (shared) return shared;
  const cfg = graphConfig();
  if (!cfg) return null;
  shared = { driver: createDriver(cfg), database: cfg.database };
  return shared;
}

/** A single-statement runner the queries module can be handed (and tests can fake). */
export type Runner = (cypher: string, params: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;

export function runnerFor(driver: Driver, database?: string): Runner {
  return async (cypher, params) => {
    const { records } = await driver.executeQuery(cypher, params, { database, routing: "READ" });
    return records.map((r) => r.toObject());
  };
}

export type TypedRunner = (
  cypher: string,
  params: Record<string, unknown>,
  opts: { timeoutMs: number },
) => Promise<{ records: Array<Record<string, unknown>>; queryType: string }>;

export function typedRunnerFor(driver: Driver, database?: string): TypedRunner {
  return async (cypher, params, opts) => {
    const { records, summary } = await driver.executeQuery(cypher, params, {
      database,
      routing: "READ",
      transactionConfig: { timeout: opts.timeoutMs },
    });
    return { records: records.map((r) => r.toObject()), queryType: summary.queryType };
  };
}

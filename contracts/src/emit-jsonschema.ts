/**
 * Emit JSON Schema files to contracts/jsonschema/ so the Python pipeline can validate
 * its output without Node (`pipeline` uses the `jsonschema` package). Run after any
 * schema change: `npm run jsonschema`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
} from "./schemas";

const out = join(__dirname, "..", "jsonschema");
mkdirSync(out, { recursive: true });

const all: Record<string, ZodTypeAny> = {
  races: RacesIndexSchema,
  ledger: LedgerSchema,
  entity: EntitySchema,
  chain: ChainSchema,
  ads: AdGallerySchema,
  dossier: DossierSchema,
  stories: StoriesSchema,
  donor: DonorViewSchema,
  trails: TrailsSchema,
};

// zod-to-json-schema's overloads make tsc recurse too deeply on large schemas; pin a simple signature.
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: { name: string; $refStrategy: "none" },
) => unknown;

for (const [name, schema] of Object.entries(all)) {
  const json = toJsonSchema(schema, { name, $refStrategy: "none" });
  writeFileSync(join(out, `${name}.schema.json`), JSON.stringify(json, null, 2));
  console.log(`wrote jsonschema/${name}.schema.json`);
}

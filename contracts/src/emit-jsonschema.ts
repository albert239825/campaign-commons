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
  HandAdIssuesFileSchema,
  HandXAdIssuesFileSchema,
  HandIeIssuesFileSchema,
  HandIssueFocusFileSchema,
  HandIssuePositionsFileSchema,
  HandXIssueFocusFileSchema,
  HandXStancesFileSchema,
  HandXAccountsFileSchema,
  HandVendorAdLinksFileSchema,
  HandVendorAliasesFileSchema,
  IssueSpendingSchema,
  LedgerSchema,
  RacesIndexSchema,
  SearchIndexSchema,
  StoriesSchema,
  TrailsSchema,
  VendorIndexSchema,
  VendorSchema,
} from "./schemas";
import { ISSUES } from "./issues";

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
  vendors: VendorIndexSchema,
  vendor: VendorSchema,
  issues: IssueSpendingSchema,
  search: SearchIndexSchema,
  // data/hand/<race>/
  hand_issue_focus: HandIssueFocusFileSchema,
  hand_issue_positions: HandIssuePositionsFileSchema,
  hand_x_issue_focus: HandXIssueFocusFileSchema,
  hand_x_stances: HandXStancesFileSchema,
  hand_x_accounts: HandXAccountsFileSchema,
  hand_ad_issues: HandAdIssuesFileSchema,
  hand_x_ad_issues: HandXAdIssuesFileSchema,
  hand_ie_issues: HandIeIssuesFileSchema,
  hand_vendor_aliases: HandVendorAliasesFileSchema,
  hand_vendor_ad_links: HandVendorAdLinksFileSchema,
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

writeFileSync(join(out, "issues_taxonomy.json"), JSON.stringify(ISSUES, null, 2) + "\n");
console.log("wrote jsonschema/issues_taxonomy.json");

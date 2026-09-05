/**
 * Validate every JSON file under data/out/ against the contracts.
 *
 *   npm run validate            # validates ../data/out
 *   npm run validate -- <dir>   # validates another directory
 *
 * Exit code 1 on any failure. Pipeline children: run this before opening a PR.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ZodTypeAny } from "zod";
import {
  AdGallerySchema,
  ChainSchema,
  DonorViewSchema,
  DossierSchema,
  EntitySchema,
  LedgerSchema,
  RacesIndexSchema,
  StoriesSchema,
} from "./schemas";

const root = process.argv[2] ?? join(__dirname, "..", "..", "data", "out");

function schemaFor(rel: string): ZodTypeAny | null {
  const parts = rel.split(sep);
  if (parts.length === 1 && parts[0] === "races.json") return RacesIndexSchema;
  if (parts.length === 2) {
    if (parts[1] === "ledger.json") return LedgerSchema;
    if (parts[1] === "ads.json") return AdGallerySchema;
    if (parts[1] === "stories.json") return StoriesSchema;
  }
  if (parts.length === 3) {
    if (parts[1] === "entities") return EntitySchema;
    if (parts[1] === "chains") return ChainSchema;
    if (parts[1] === "dossiers") return DossierSchema;
    if (parts[1] === "donors") return DonorViewSchema;
  }
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

let ok = 0;
let failed = 0;
let skipped = 0;

for (const file of walk(root)) {
  const rel = relative(root, file);
  const schema = schemaFor(rel);
  if (!schema) {
    skipped++;
    console.log(`SKIP  ${rel} (no schema for this path)`);
    continue;
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const res = schema.safeParse(data);
  if (res.success) {
    ok++;
  } else {
    failed++;
    console.error(`FAIL  ${rel}`);
    for (const issue of res.error.issues.slice(0, 20)) {
      console.error(`      ${issue.path.join(".") || "<root>"}: ${issue.message}`);
    }
    if (res.error.issues.length > 20) console.error(`      ... ${res.error.issues.length - 20} more`);
  }
}

console.log(`\n${ok} ok, ${failed} failed, ${skipped} skipped (root: ${root})`);
process.exit(failed ? 1 : 0);

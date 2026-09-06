import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AdGallerySchema, ChainSchema, DonorViewSchema, EntitySchema, LedgerSchema, TrailsSchema } from "@campaign-commons/contracts";
import { adName, adSpend, edgeType, graphRows, machineTags, NO_TAGS, REL } from "./schema";

const out = join(process.cwd(), "..", "data", "out", "pa-sen-2024");
const read = (...p: string[]) => JSON.parse(readFileSync(join(out, ...p), "utf8")) as unknown;
const ledger = LedgerSchema.parse(read("ledger.json"));
const trails = TrailsSchema.parse(read("trails.json"));
const winsenate = ChainSchema.parse(read("chains", "C00865444.json"));
const casey = ledger.candidates.find((c) => c.name === "Bob Casey")!;
const campaigns = ledger.candidates.map((c) => EntitySchema.parse(read("entities", `${c.principal_committee_id}.json`)));
const caseyCommittee = campaigns.find((e) => e.entity_id === casey.principal_committee_id)!;
const donor = DonorViewSchema.parse(read("donors", "ind-ADELSON_MIRIAM-89145.json"));
const ads = AdGallerySchema.parse(read("ads.json")).ads;

const rows = () => graphRows({ raceId: "pa-sen-2024", chains: [winsenate], ledger, trails, entities: campaigns });

describe("edgeType", () => {
  const ofKind = (kind: "money" | "placement" | "targeting") => winsenate.edges.find((e) => (e.kind ?? "money") === kind)!;
  it("splits chain kinds into the graph's relationship types, by side for money", () => {
    expect(edgeType(ofKind("money"), "in")).toBe(REL.GAVE);
    expect(edgeType(ofKind("money"), "out")).toBe(REL.PAID);
    expect(edgeType(ofKind("placement"), "out")).toBe(REL.PLACED);
    expect(edgeType(ofKind("targeting"), "out")).toBe(REL.TARGETED);
  });
});

describe("graphRows", () => {
  it("keeps every node and edge's source_url from the artifact it was read from", () => {
    const { nodes, edges } = rows();
    expect(edges.length).toBeGreaterThan(50);
    expect(edges.every((e) => e.source_url === null || e.source_url.startsWith("https://"))).toBe(true);
    // chains publish ad placements without a per-edge url; every money and targeting edge has one
    expect(edges.filter((e) => e.source_url === null && e.type !== REL.PLACED)).toEqual([]);
    const withUrl = nodes.filter((n) => n.source_url !== null).length;
    expect(withUrl).toBeGreaterThan(nodes.length / 2);
  });

  it("never writes a targeting edge as money: GAVE/PAID and TARGETED are disjoint and TARGETED carries for/against", () => {
    const { edges } = rows();
    const targeted = edges.filter((e) => e.type === REL.TARGETED);
    expect(targeted.length).toBeGreaterThan(0);
    expect(targeted.every((e) => e.support_oppose === "S" || e.support_oppose === "O")).toBe(true);
    expect(targeted.every((e) => e.to === casey.candidate_id || ledger.candidates.some((c) => c.candidate_id === e.to))).toBe(true);
    const money = edges.filter((e) => e.type === REL.GAVE || e.type === REL.PAID);
    expect(money.some((e) => ledger.candidates.some((c) => c.candidate_id === e.to))).toBe(false);
  });

  it("adds each candidate and their campaign committee from the ledger, joined by CAMPAIGN_OF", () => {
    const { nodes, edges } = rows();
    const cand = nodes.find((n) => n.id === casey.candidate_id)!;
    expect(cand.kind).toBe("candidate");
    expect(cand.href).toBe(`/races/pa-sen-2024/candidates/${casey.candidate_id}`);
    const link = edges.find((e) => e.type === REL.CAMPAIGN_OF && e.to === casey.candidate_id)!;
    expect(link.from).toBe(casey.principal_committee_id);
    expect(link.source_url).toBe(casey.campaign.source_url);
  });

  it("projects entity inflows as GAVE into the committee, typing individuals and orgs by id prefix", () => {
    const { nodes, edges } = rows();
    const campaignIds = campaigns.map((e) => e.entity_id);
    const into = edges.filter((e) => e.type === REL.GAVE && campaignIds.includes(e.to));
    expect(into.length).toBeGreaterThan(10);
    const ind = into.find((e) => e.from.startsWith("ind:"))!;
    expect(nodes.find((n) => n.id === ind.from)!.kind).toBe("individual");
    expect(nodes.find((n) => n.id === into.find((e) => e.from.startsWith("C"))!.from)!.kind).toBe("committee");
    const sample = caseyCommittee.inflows[0];
    const projected = into.find((e) => e.from === sample.from_entity_id && e.transaction_types.join() === (sample.transaction_type ?? ""))!;
    expect(projected.amount).toBe(sample.amount);
    expect(projected.source_url).toBe(sample.source_url);
    expect(projected.chains).toEqual([]);
  });

  it("collapses an edge published in several places onto one row and keeps the chains it came from", () => {
    const { edges: once } = graphRows({ raceId: "pa-sen-2024", chains: [winsenate] });
    const { edges: twice } = graphRows({ raceId: "pa-sen-2024", chains: [winsenate, winsenate] });
    expect(twice.map((e) => e.key)).toEqual(once.map((e) => e.key));
    expect(twice.every((e) => e.chains.length === 1)).toBe(true);
  });

  it("takes from a donor page only the donor's own gifts, not the pooled downstream totals", () => {
    const { edges } = graphRows({ raceId: "pa-sen-2024", chains: [], donors: [donor] });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.type === REL.GAVE && e.from === donor.donor_id)).toBe(true);
    expect(edges.length).toBe(donor.edges.filter((e) => e.kind === "money" && e.from === donor.donor_id).length);
  });

  it("projects each matched ad as sponsor PLACED ad, and ad TARGETED candidate only where the ad names one, never as money to the candidate", () => {
    const { nodes, edges } = graphRows({ raceId: "pa-sen-2024", chains: [], ledger, ads });
    const matched = ads.filter((a) => a.matched_entity_id !== null);
    const placed = edges.filter((e) => e.type === REL.PLACED);
    expect(placed.length).toBe(new Set(matched.map((a) => a.ad_id)).size);
    const sample = matched.find((a) => a.support_oppose !== null && a.candidate_ids.length > 0)!;
    const adNode = nodes.find((n) => n.id === sample.ad_id)!;
    expect(adNode).toMatchObject({ kind: "ad", name: adName(sample), source_url: sample.source_url, href: `/races/pa-sen-2024/ads/${sample.ad_id}` });
    expect(placed.find((e) => e.to === sample.ad_id)).toMatchObject({ from: sample.matched_entity_id, amount: adSpend(sample), source_url: sample.source_url, basis: "inferred" });
    const targeted = edges.filter((e) => e.type === REL.TARGETED && e.from === sample.ad_id);
    expect(targeted.map((e) => e.to)).toEqual(sample.candidate_ids);
    expect(targeted[0].support_oppose).toBe(sample.support_oppose);
    expect(edges.filter((e) => e.from === sample.ad_id && (e.type === REL.GAVE || e.type === REL.PAID))).toEqual([]);
    const unnamed = matched.find((a) => a.support_oppose === null)!;
    expect(edges.filter((e) => e.from === unnamed.ad_id)).toEqual([]);
  });

  it("carries the machine issue layer and spender positions as their own node properties, never touching record properties", () => {
    const provenance = { tagged_by: "grok", tagged_at: "2026-09-06", model: "grok", prompt_version: "v1", tools: ["web_search" as const], tool_filters: {}, response_id: null, retrieved_at: "2026-09-06", citations: ["https://example.com/"], confidence: "high" as const, review_status: "pending" as const, reviewed_by: null, reviewed_at: null, review_note: null };
    const basis = { basis: "inferred" as const, source_urls: ["https://example.com/"], checked_by: "grok", checked_at: "2026-09-06", rule: "quote verified on page" };
    const focus = { kind: "multi_issue" as const, issue_ids: ["crypto_fintech" as const, "tech_ai" as const], label: "Machine-tagged from the organization's own website (grok, 2026-09-06); not part of the record" };
    const tagged = { ...donor, donor_id: "org:FAIRSHAKE", name: "FAIRSHAKE", kind: "organization" as const, nodes: [{ ...donor.nodes[0], id: "org:FAIRSHAKE", name: "FAIRSHAKE", kind: "organization" as const }, ...donor.nodes.slice(1)], x_enrichment: { issue_focus: { ...focus, description: "d", basis, quote: "q", provenance } } };
    const spender = { ...caseyCommittee, issue_positions: [{ issue_id: "guns" as const, direction: 1, quote: "q", source_url: "https://example.com/", basis }, { issue_id: "guns" as const, direction: 2, quote: "q2", source_url: "https://example.com/", basis }] };
    const { nodes } = graphRows({ raceId: "pa-sen-2024", chains: [winsenate], ledger, entities: [spender], donors: [tagged] });
    const org = nodes.find((n) => n.id === "org:FAIRSHAKE")!;
    expect(org).toMatchObject({ name: "FAIRSHAKE", kind: "organization", machine_issue_ids: ["crypto_fintech", "tech_ai"], machine_kind: "multi_issue", machine_label: focus.label, issue_position_ids: [] });
    const cmte = nodes.find((n) => n.id === caseyCommittee.entity_id)!;
    expect(cmte).toMatchObject({ name: caseyCommittee.name, source_url: caseyCommittee.source_url, machine_issue_ids: [], machine_kind: null, machine_label: null, issue_position_ids: ["guns"] });
    // nothing in the machine layer reaches a record property, and every other node carries the empty tags
    expect(Object.keys(org).filter((k) => k.startsWith("machine_") || k === "issue_position_ids").sort()).toEqual(["issue_position_ids", "machine_issue_ids", "machine_kind", "machine_label"]);
    expect(nodes.filter((n) => n.id !== "org:FAIRSHAKE" && n.id !== caseyCommittee.entity_id).every((n) => JSON.stringify(machineTags(n as never)) === JSON.stringify(NO_TAGS) && n.machine_issue_ids.length === 0 && n.machine_label === null)).toBe(true);
    expect(machineTags({})).toEqual(NO_TAGS);
  });

  it("draws an ad's spend as the range midpoint, or the floor of an open-ended range", () => {
    expect(adSpend({ spend_range: { min: 500_000, max: 600_000 } })).toBe(550_000);
    expect(adSpend({ spend_range: { min: 1_000_000, max: null } })).toBe(1_000_000);
    expect(adName({ ad_type: "video", first_shown: "2024-10-22", last_shown: "2024-11-05" })).toBe("Video ad · 2024-10-22 – 2024-11-05");
    expect(adName({ ad_type: "unknown", first_shown: null, last_shown: null })).toBe("Ad");
  });
});

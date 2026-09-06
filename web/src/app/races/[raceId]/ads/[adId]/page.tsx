import Link from "next/link";
import { notFound } from "next/navigation";
import { TARGETING_COLOR, VISIBILITY_COLORS } from "@campaign-commons/contracts";
import { getAds, getChain, getEntity, getRace, hasChain, listDonorKeys, listDossierIds, listEntityIds, listRaceIds } from "@/lib/data";
import { date, money, pct, range, routes } from "@/lib/format";
import { Breadcrumbs, Card, Chip, DataStatusBanner, Legend, SourceLink, Stat, Swatch } from "@/components/ui";
import { AD_TYPE_LABEL, Creative, IssueChips, SameWindowBuys, VendorLines, isVerified } from "@/components/ads/ad-card";
import { adFocusWire, adTitle, spendMidpoint } from "@/components/chain/ad-view";
import { ChainDiagram, PLACEMENT_COLOR } from "@/components/chain/chain-diagram";
import type { NodeLinks } from "@/components/chain/links";

export const generateStaticParams = () => listRaceIds().flatMap((raceId) => getAds(raceId).ads.map((ad) => ({ raceId, adId: ad.ad_id })));

export default async function AdPage({ params }: { params: Promise<{ raceId: string; adId: string }> }) {
  const { raceId, adId } = await params;
  const race = getRace(raceId);
  const gallery = getAds(raceId);
  const ad = gallery.ads.find((a) => a.ad_id === adId);
  if (!ad) notFound();

  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));
  const entityIds = new Set(listEntityIds(raceId));
  const dossierIds = new Set(listDossierIds(raceId));
  const sponsorId = ad.matched_entity_id;
  const sponsor = sponsorId && entityIds.has(sponsorId) ? getEntity(raceId, sponsorId) : null;
  const chain = sponsorId && hasChain(raceId, sponsorId) ? getChain(raceId, sponsorId) : null;
  const links: NodeLinks = {
    raceId,
    entityIds,
    donorKeys: new Set(listDonorKeys(raceId)),
  };
  const vendorLinks = ad.vendor_links ?? [];
  const sameWindow = ad.same_window_buys ?? [];
  const verified = isVerified(ad);
  const dark = ad.sponsor_visibility_shares?.dark ?? null;
  const targets = ad.candidate_ids.map((id) => candidateNames[id] ?? id);
  const title = adTitle(ad);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { href: routes.home(), label: "Races" },
          { href: routes.race(raceId), label: race.label },
          { href: routes.ads(raceId), label: "Ads" },
          { label: title },
        ]}
      />
      <DataStatusBanner status={gallery.data_status} />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {AD_TYPE_LABEL[ad.ad_type]} by {ad.advertiser_name}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
          {sponsor && (
            <Link href={routes.entity(raceId, sponsor.entity_id)} className="font-medium text-neutral-900 hover:underline">
              Sponsor: {sponsor.name}
            </Link>
          )}
          {chain && (
            <Link href={routes.chain(raceId, chain.root_entity_id)} className="font-medium text-neutral-900 hover:underline">
              Sponsor&apos;s full chain →
            </Link>
          )}
          <SourceLink href={ad.creative_url} label="ad library record" />
          {verified &&
            ad.verification?.evidence_urls
              .filter((u) => u.startsWith("https://www.fec.gov/"))
              .map((u) => <SourceLink key={u} href={u} label="fec.gov record" />)}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <Creative ad={ad} className="max-h-[28rem]" />
          <p className="mt-2 text-[11px] text-neutral-500">Creative cached from the platform&apos;s transparency library; the live record is linked above.</p>
        </Card>
        <div className="space-y-4">
          <Card>
            <div className="grid grid-cols-2 gap-4">
              <Stat
                label="Spend (platform range)"
                value={range(ad.spend_range.min, ad.spend_range.max, (n) => money(n))}
                sub={`midpoint ${money(spendMidpoint(ad.spend_range), { compact: false })} · not a filed figure`}
              />
              <Stat label="Impressions (range)" value={range(ad.impressions_range.min, ad.impressions_range.max)} />
              <Stat label="Shown" value={`${date(ad.first_shown)} – ${date(ad.last_shown)}`} sub={ad.regions.length > 0 ? ad.regions.join(", ") : undefined} />
              <Stat label="Platform" value={<span className="capitalize">{ad.platform}</span>} sub={AD_TYPE_LABEL[ad.ad_type]} />
            </div>
          </Card>
          <Card title="Sponsor">
            <div className="flex flex-wrap gap-1">
              {verified ? (
                <Chip
                  tone="green"
                  title="A person matched the advertiser's legal name on adstransparency.google.com to this committee's fec.gov record. Google's bulk data names the advertiser and carries no paid-for-by field for US ads."
                >
                  sponsor verified by hand
                </Chip>
              ) : sponsorId ? (
                <Chip tone="amber" title="String match on advertiser name; not yet human-verified">
                  sponsor auto-matched
                </Chip>
              ) : (
                <Chip tone="muted">sponsor not matched to an FEC committee</Chip>
              )}
              {ad.support_oppose && targets.length > 0 && (
                <Chip tone="neutral">
                  {ad.support_oppose === "S" ? "supports" : "opposes"} {targets.join(", ")}
                </Chip>
              )}
            </div>
            {dark !== null && sponsorId && (
              <p
                className="mt-2 text-sm text-neutral-700"
                title="Share of the sponsor committee's traced receipts that stopped at an organization with no donor-disclosure obligation. Describes the sponsor's funding, not this ad."
              >
                <span className="font-semibold tabular-nums text-neutral-900">{pct(dark)}</span> of this sponsor&apos;s traced money is dark
                {ad.sponsor_visibility_shares && (
                  <span className="text-neutral-500">
                    {" "}
                    · {pct(ad.sponsor_visibility_shares.disclosed)} disclosed · {pct(ad.sponsor_visibility_shares.inferable)} inferable
                  </span>
                )}
              </p>
            )}
            {ad.issues && (
              <div className="mt-2 space-y-1">
                <IssueChips ad={ad} />
                <p className="text-[11px] text-neutral-500">
                  Issue tags: {ad.issues.basis.rule} ({ad.issues.basis.checked_by ?? "unknown"}, {ad.issues.basis.checked_at ?? "—"}).
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="Which vendor placed this ad">
        {vendorLinks.length === 0 && sameWindow.length === 0 ? (
          <p className="text-xs text-neutral-500">
            {sponsorId
              ? "No Schedule E payment by this sponsor to a digital, production or unclassified vendor falls in this ad's run window (up to 7 days before first shown) — not evidence that nobody was paid."
              : "The advertiser is not matched to an FEC committee, so its filings cannot be searched for vendors."}
          </p>
        ) : (
          <div className="space-y-3">
            {vendorLinks.length > 0 ? (
              <>
                <p className="text-xs text-neutral-600">
                  A vendor is linked to this ad only when a person verified it from a source naming both, or when it was the only digital vendor the sponsor
                  paid in the week before and while the ad ran (inferred). Each link says what it rests on.
                </p>
                <VendorLines links={vendorLinks} raceId={raceId} />
              </>
            ) : (
              <p className="text-xs text-neutral-600">
                Unknown. Nothing filed joins a {ad.platform === "google" ? "Google" : "platform"} creative to a Schedule E payment, and no rule or person has
                linked this one.
              </p>
            )}
            <SameWindowBuys ad={ad} raceId={raceId} sponsorName={sponsor?.name ?? ad.advertiser_name} />
          </div>
        )}
      </Card>

      {chain && (
        <Card
          title="Where the sponsor's money came from, and how it reached this ad"
          action={
            <Legend
              items={[
                {
                  swatch: <Swatch color={VISIBILITY_COLORS.disclosed} />,
                  label: "disclosed (FEC)",
                },
                {
                  swatch: <Swatch color={VISIBILITY_COLORS.inferable} />,
                  label: "inferable (990, lagged)",
                },
                {
                  swatch: <Swatch color={VISIBILITY_COLORS.dark} className="bg-[repeating-linear-gradient(45deg,#e24b4a_0_2px,#fdecec_2px_4px)]" />,
                  label: "dark wall (no disclosure)",
                },
                {
                  swatch: <span className="inline-block h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: PLACEMENT_COLOR }} />,
                  label: "vendor / this ad",
                },
                {
                  swatch: <span className="inline-block h-0.5 w-5 align-middle" style={{ backgroundColor: PLACEMENT_COLOR }} />,
                  label: "placement: solid = filed or verified · dashed = inferred",
                },
                {
                  swatch: <span className="inline-block h-0.5 w-5 align-middle" style={{ backgroundColor: TARGETING_COLOR }} />,
                  label: "targeting — no money reaches the candidate",
                },
              ]}
            />
          }
        >
          <ChainDiagram wire={adFocusWire(chain, ad, links, candidateNames, dossierIds)} />
          <p className="mt-2 text-xs text-neutral-500">
            The sponsor&apos;s funding chain, read left to right into {chain.root_name}; to the right, only what touches this creative. Click a node for its
            details and the evidence behind each link; + / − expands or folds what hangs off it.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            <span className="font-medium text-neutral-700">Assumptions.</span> Vendor dollars are Schedule E payments as filed. The ad&apos;s dollars are the
            midpoint of the range Google reports, not a filed figure, and are never added to the vendor dollars. A vendor → ad edge is drawn only when a person
            verified it from a source naming both (solid) or that vendor was the only digital vendor the sponsor paid in the week before and while the ad ran
            (dashed, inferred). Other vendors paid in that window are listed above as a sentence, not drawn: overlapping dates are not evidence of who placed
            the ad. Donor
            dollars on the left are pooled: none of them can be said to have bought this ad. Nothing here reaches the candidate.
          </p>
        </Card>
      )}
      {!chain && sponsorId && (
        <p className="text-xs text-neutral-500">
          No funding chain was walked for this sponsor in this race, so the picture above cannot be drawn. See the{" "}
          <Link href={routes.entity(raceId, sponsorId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            sponsor page
          </Link>
          .
        </p>
      )}
    </div>
  );
}

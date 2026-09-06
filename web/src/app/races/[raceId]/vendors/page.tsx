// OWNER: Block 2 — vendors.
import Link from "next/link";
import { getAds, getRace, getVendors, listRaceIds } from "@/lib/data";
import { pct, routes } from "@/lib/format";
import { vendorAdContext } from "@/lib/vendors";
import { Card, Money, Stat } from "@/components/ui";
import { DetailHeader, SectionNav } from "@/components/ui/detail-layout";
import { RaceShell } from "@/components/ui/race-shell";
import { MEDIUM_COLORS, MEDIUM_LABELS, MediumBar, MediumBasisNote } from "@/components/vendors/medium";
import { VendorIndex } from "@/components/vendors/vendor-index";
import { VendorRow } from "@/components/vendors/vendor-row";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

const LARGEST = 10;

export default async function VendorsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const index = getVendors(raceId);
  const context = vendorAdContext(getAds(raceId).ads);
  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));
  const handChecked = index.vendors.filter((v) => v.normalization.basis === "verified").length;
  const largest = index.vendors.slice(0, LARGEST);
  const linked = index.vendors.filter((v) => (context.links[v.vendor_id]?.ads ?? 0) > 0);
  const verifiedLinked = linked.filter((v) => context.links[v.vendor_id].verified > 0).length;
  const inWindows = index.vendors
    .filter((v) => (context.windows[v.vendor_id]?.ads ?? 0) > 0)
    .sort((a, b) => context.windows[b.vendor_id].ads - context.windows[a.vendor_id].ads || b.total - a.total);
  const rowProps = (v: (typeof index.vendors)[number]) => ({ raceId, vendor: v, links: context.links[v.vendor_id], context: context.windows[v.vendor_id], candidateNames });

  return (
    <RaceShell
      race={race}
      section="vendors"
      status={index.data_status}
      crumbs={[{ label: "Vendors" }]}
      className="vendors-page"
      header={
        <DetailHeader label={race.label} title="Vendors">
          <p>Firms and platforms reported as payees in the outside-spending records for this race.</p>
          <p className="detail-assumption">
            Vendor totals describe reported payments — money from a spender to a firm; the candidate named on a buy received nothing. A
            vendor is linked to an individual ad only when the evidence supports that relationship or the exact-one-digital-vendor rule
            applies.
          </p>
        </DetailHeader>
      }
    >
      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Vendors" value={index.vendors.length.toLocaleString("en-US")} sub={`${handChecked} with hand-checked aliases`} />
          <Stat label="Reported vendor payments" value={<Money amount={index.total} />} sub="Schedule E rows on fec.gov; equals the race's outside total" />
          <Stat
            label="Vendors linked to ads"
            value={linked.length.toLocaleString("en-US")}
            sub={linked.length === 0 ? "no link has enough evidence yet" : `${verifiedLinked} verified by hand · ${linked.length - verifiedLinked} inferred by rule`}
          />
          <Stat
            label="Ads with same-window vendor context"
            value={`${context.adsWithWindowContext.toLocaleString("en-US")} of ${context.ads.toLocaleString("en-US")}`}
            sub="context, not links; Google spend is a platform range, never added to these dollars"
          />
        </div>
      </Card>

      <p className="detail-callout">
        A vendor appears as linked to an ad only when a source names both sides or when it was the only digital vendor paid in the week
        before and while the ad ran. Other vendors paid during the same window are listed as context, not drawn as links. Every figure
        here is a sum of Schedule E rows and links to them on fec.gov.
      </p>

      <div className="detail-sections">
        <aside className="detail-sidebar">
          <SectionNav
            items={[
              { id: "largest", label: "Largest reported payments" },
              { id: "linked", label: "Vendors linked to ads", note: `${linked.length}` },
              { id: "windows", label: "Paid during ad windows", note: `${inWindows.length}` },
              { id: "medium", label: "By medium" },
              { id: "all", label: "All vendors", note: `${index.vendors.length}` },
            ]}
          />
        </aside>
        <div className="detail-content">
          <div id="largest" className="detail-section">
            <Card title="Largest reported payments">
              {largest.length === 0 ? (
                <p className="detail-empty">No independent expenditures with a payee in this race.</p>
              ) : (
                <ol className="vendor-list">
                  {largest.map((v) => (
                    <VendorRow key={v.vendor_id} {...rowProps(v)} />
                  ))}
                </ol>
              )}
              {index.vendors.length > LARGEST && (
                <p className="vendor-section-more">
                  Top {LARGEST} of {index.vendors.length.toLocaleString("en-US")} vendors by reported dollars. <a href="#all">All vendors ↓</a>
                </p>
              )}
            </Card>
          </div>

          <div id="linked" className="detail-section">
            <Card title="Vendors linked to ads">
              <p>
                {context.adsWithLinks.toLocaleString("en-US")} of {context.ads.toLocaleString("en-US")} ads in the{" "}
                <Link href={routes.ads(raceId)}>ads wall</Link> carry a vendor link. Each link has a basis: <em>verified by hand</em> when a person
                found a source naming both sides, <em>inferred</em> when the sponsor paid exactly one digital vendor in the week before and while the
                ad ran. Nothing filed with the FEC joins a buy to a creative, so a link is never read straight off a filing.
              </p>
              {linked.length === 0 ? (
                <p className="detail-empty">No vendor in this race has an ad link with enough evidence yet.</p>
              ) : (
                <ol className="vendor-list">
                  {linked.map((v) => (
                    <VendorRow key={v.vendor_id} {...rowProps(v)} />
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div id="windows" className="detail-section">
            <Card title="Paid during ad windows">
              <p>
                Context, not a relationship: these vendors were paid by an ad&apos;s sponsor for media that could place or produce a platform ad, in the
                week before or while that ad ran — whether or not the pair also met the bar for a link. FEC records do not say which buy placed
                which ad, so the count is a fact about dates and is never drawn as a vendor → ad edge.
              </p>
              {inWindows.length === 0 ? (
                <p className="detail-empty">No same-window vendor payments in this race.</p>
              ) : (
                <details className="vendor-disclosure">
                  <summary>
                    {inWindows.length.toLocaleString("en-US")} vendors paid during the run window of {context.adsWithWindowContext.toLocaleString("en-US")} ads
                  </summary>
                  <ol className="vendor-list">
                    {inWindows.map((v) => (
                      <VendorRow key={v.vendor_id} {...rowProps(v)} />
                    ))}
                  </ol>
                </details>
              )}
            </Card>
          </div>

          <div id="medium" className="detail-section">
            <Card title="By medium">
              <MediumBar mix={index.by_medium} />
              <div className="vendor-medium-grid">
                {index.by_medium.map((m) => (
                  <div key={m.medium}>
                    <div className="vendor-medium-label">
                      <span style={{ background: MEDIUM_COLORS[m.medium] }} aria-hidden />
                      {MEDIUM_LABELS[m.medium]} · {pct(m.amount / index.total)}
                    </div>
                    <div className="tabular-nums">
                      <Money amount={m.amount} /> <span className="text-neutral-500">{m.count.toLocaleString("en-US")} payments</span>
                    </div>
                  </div>
                ))}
              </div>
              <MediumBasisNote basis={index.medium_basis} className="mt-3" />
            </Card>
          </div>

          <div id="all" className="detail-section">
            <Card title="All vendors">
              <VendorIndex raceId={raceId} vendors={index.vendors} context={context} candidateNames={candidateNames} />
            </Card>
          </div>
        </div>
      </div>

      {index.notes.length > 0 && (
        <footer className="vendor-notes">
          <p>How these figures were made</p>
          <ul>
            {index.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <Link href={routes.methodology()}>Methodology</Link>
        </footer>
      )}
    </RaceShell>
  );
}

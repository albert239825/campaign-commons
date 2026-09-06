import Link from "next/link";
import type { VendorSummary } from "@campaign-commons/contracts";
import { BASIS_LABELS, BASIS_MEANING, BASIS_TONE } from "@/lib/evidence";
import { date, pct, routes } from "@/lib/format";
import { linkEvidence, topMedium, type VendorLinks, type VendorWindow } from "@/lib/vendors";
import { Chip, Money, SourceLink } from "@/components/ui";
import { MEDIUM_LABELS } from "./medium";
import { TargetsLine } from "./targets-line";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * One vendor in an index list: what was filed (payments, medium, dates, targets) on the left; the money, who paid it and
 * the evidence for any ad link on the right. `links` and `context` come from the ads (lib/vendors.ts) and are shown as two
 * different things — a link has a basis, same-window context is only a count.
 */
export function VendorRow({
  raceId,
  vendor: v,
  links,
  context,
  candidateNames,
}: {
  raceId: string;
  vendor: VendorSummary;
  links?: VendorLinks;
  context?: VendorWindow;
  candidateNames: Record<string, string>;
}) {
  const medium = topMedium(v);
  const evidence = linkEvidence(links);
  const dates = v.first_date === v.last_date ? date(v.first_date) : `${date(v.first_date)} – ${date(v.last_date)}`;
  return (
    <li className="vendor-row">
      <div className="vendor-row-main">
        <h3>
          <Link href={routes.vendor(raceId, v.vendor_id)}>{v.name}</Link>
        </h3>
        <p className="vendor-row-meta">
          {medium && (
            <>
              <span>
                {MEDIUM_LABELS[medium.medium]}
                {v.media_mix.length > 1 && ` ${pct(medium.amount / v.total)}`}
              </span>
              {" · "}
            </>
          )}
          <span>{plural(v.count, "payment")}</span>
          {" · "}
          <span>{dates}</span>
          {links && links.ads > 0 && (
            <>
              {" · "}
              <span>{plural(links.ads, "linked ad")}</span>
            </>
          )}
          {context && context.ads > 0 && (
            <>
              {" · "}
              <span title="Paid by the sponsor in the week before or while these ads ran — context, not a link">paid during {plural(context.ads, "ad window")}</span>
            </>
          )}
          {v.aliases.length > 1 && (
            <>
              {" · "}
              <span title={v.aliases.join(" · ")}>
                {plural(v.aliases.length, "spelling")}, {BASIS_LABELS[v.normalization.basis]}
              </span>
            </>
          )}
        </p>
        {v.targets.length > 0 && (
          <p className="vendor-row-meta">
            <TargetsLine raceId={raceId} targets={v.targets} candidateNames={candidateNames} />
          </p>
        )}
      </div>
      <div className="vendor-row-figures">
        <p className="vendor-row-amount">
          <Money amount={v.total} compact={false} /> <small>reported</small>
        </p>
        <p className="vendor-row-sponsors">
          {plural(v.spenders.length, "sponsor")}
          {v.spenders.length > 0 && (
            <>
              {": "}
              {v.spenders.slice(0, 2).map((s, i) => (
                <span key={s.entity_id}>
                  {i > 0 && ", "}
                  <Link href={routes.entity(raceId, s.entity_id)}>{s.name}</Link>
                </span>
              ))}
              {v.spenders.length > 2 && ` +${v.spenders.length - 2}`}
            </>
          )}
        </p>
        <p className="vendor-row-evidence">
          {evidence ? (
            <Chip tone={BASIS_TONE[evidence]} title={BASIS_MEANING[evidence]}>
              {BASIS_LABELS[evidence]}
              {links && links.verified > 0 && links.inferred > 0 && ` · ${links.inferred} inferred`}
            </Chip>
          ) : context && context.ads > 0 ? (
            <Chip tone="muted" title="The sponsor paid this vendor for placeable media in the week before or while these ads ran. FEC records do not say which buy placed which ad, so this is context, not a link.">
              not linked · context only
            </Chip>
          ) : (
            <Chip tone="muted">no linked ads</Chip>
          )}
          <SourceLink href={v.source_url} label="FEC" />
        </p>
      </div>
    </li>
  );
}

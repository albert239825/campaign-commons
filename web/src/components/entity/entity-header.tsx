import Link from "next/link";
import { COMMITTEE_TYPE_LABELS, type Entity } from "@citizen-gotham/contracts";
import { date, routes } from "@/lib/format";
import { FlagBadge, Money, SourceLink, VisibilityBadge } from "@/components/ui";

const DESIGNATIONS: Record<string, string> = {
  A: "Authorized by a candidate",
  B: "Lobbyist/registrant PAC",
  D: "Leadership PAC",
  J: "Joint fundraiser",
  P: "Principal campaign committee",
  U: "Unauthorized",
};

const fecReceipts = (id: string) => `https://www.fec.gov/data/receipts/?committee_id=${id}&two_year_transaction_period=2024`;
const fecDisbursements = (id: string) => `https://www.fec.gov/data/disbursements/?committee_id=${id}&two_year_transaction_period=2024`;
const fecIndependentExpenditures = (id: string) => `https://www.fec.gov/data/independent-expenditures/?q_spender=${id}&cycle=2024&data_type=processed&is_notice=false`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function EntityHeader({ raceId, e, chain }: { raceId: string; e: Entity; chain: boolean }) {
  const addr = e.address;
  const addrLine = addr && [addr.street, [addr.city, addr.state].filter(Boolean).join(", "), addr.zip].filter(Boolean).join(" · ");
  const typeLabel = e.committee_type ? COMMITTEE_TYPE_LABELS[e.committee_type] : e.committee_type_label;
  return (
    <header className="border-b border-neutral-300 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            {e.kind}
            {typeLabel ? ` · ${typeLabel}` : ""}
            {e.is_conduit ? " · conduit" : ""}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{e.name}</h1>
          {e.aliases.filter((a) => a.toLowerCase() !== e.name.toLowerCase()).length > 0 && (
            <div className="mt-0.5 text-xs text-neutral-500">
              also filed as {e.aliases.filter((a) => a.toLowerCase() !== e.name.toLowerCase()).join(" · ")}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <VisibilityBadge visibility={e.visibility} />
            {e.flags.map((f) => (
              <FlagBadge key={f.id} flag={f} />
            ))}
          </div>
        </div>
        {chain && (
          <Link
            href={routes.chain(raceId, e.entity_id)}
            className="rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Follow the money chain →
          </Link>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Field label="FEC ID">
          <span className="font-mono">{e.entity_id}</span>
        </Field>
        <Field label="Designation">{e.designation ? `${DESIGNATIONS[e.designation] ?? e.designation} (${e.designation})` : "—"}</Field>
        <Field label="Registered">{e.registration_date ? date(e.registration_date) : "—"}</Field>
        <Field label="Treasurer">{e.treasurer ?? "—"}</Field>
        {addrLine && (
          <Field label="Address">
            <span className="md:col-span-2">{addrLine}</span>
          </Field>
        )}
        <Field label="2024-cycle receipts">
          <Money amount={e.totals.receipts} compact={false} /> <SourceLink href={fecReceipts(e.entity_id)} label="FEC" />
        </Field>
        <Field label="Disbursements">
          <Money amount={e.totals.disbursements} compact={false} /> <SourceLink href={fecDisbursements(e.entity_id)} label="FEC" />
        </Field>
        <Field label="Independent expenditures (all races, 2024 cycle)">
          <Money amount={e.totals.independent_expenditures} compact={false} /> <SourceLink href={fecIndependentExpenditures(e.entity_id)} label="FEC" />
        </Field>
      </dl>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <SourceLink href={e.source_url} label="FEC committee page" />
        <SourceLink href={fecReceipts(e.entity_id)} label="FEC receipts" />
        <SourceLink href={fecDisbursements(e.entity_id)} label="FEC disbursements" />
      </div>
    </header>
  );
}

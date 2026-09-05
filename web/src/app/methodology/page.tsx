// OWNER: master session. Plain-English methodology; keep in sync with docs/DECISIONS.md.
import { UNWALKED_COLOR, UNWALKED_LABEL, VISIBILITY_COLORS, VISIBILITY_LABELS } from "@citizen-gotham/contracts";
import { Card } from "@/components/ui";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>
      <Card title="What we show">
        <p className="text-sm">
          Public records, joined. Campaign finance from FEC bulk filings and the OpenFEC API; votes and bills from congress.gov and
          senate.gov; ads from platform transparency libraries. Every number links to the record it came from. We show adjacency —
          this money, this position, same person — and never assert that one caused the other.
        </p>
      </Card>
      <Card title="Visibility">
        <ul className="space-y-1 text-sm">
          {(Object.keys(VISIBILITY_LABELS) as (keyof typeof VISIBILITY_LABELS)[]).map((v) => (
            <li key={v} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: VISIBILITY_COLORS[v] }} />
              <b>{VISIBILITY_LABELS[v]}</b>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: UNWALKED_COLOR }} />
            <b>{UNWALKED_LABEL}</b>
          </li>
        </ul>
        <p className="mt-2 text-sm">
          Super PAC spending is <i>disclosed</i>: the FEC publishes their donors. &quot;Dark money&quot; is narrower: a layer — typically a
          501(c)(4) or LLC — whose own donors are not required to be published. A chain is dark only where it ends in such a layer.
        </p>
      </Card>
      <Card title="Money edges vs. targeting edges">
        <p className="text-sm">
          A contribution or transfer moves money from one entity to another. An independent expenditure supports or opposes a
          candidate but moves no money to them; a super PAC cannot give to a campaign. We never draw a money edge from a super PAC to
          a candidate. If the data appears to show one, we flag it rather than render it.
        </p>
      </Card>
      <Card title="Traceability (preliminary)">
        <p className="text-sm">
          For each outside spender in a race we walk its receipts backward through committee transfers until each dollar reaches a
          named individual, a business or union giving from its own treasury, or an organization whose own funding is not on file
          (a 501(c)(4), LLC or trust). Edges below 1% of a committee&apos;s receipts are grouped as &quot;other&quot;. The score is the
          share of outside dollars that reach a named individual, business or union.
        </p>
        <p className="mt-2 text-sm">
          Organizations are classified from their FEC-reported name only (union, business, LLC/trust, advocacy nonprofit, or
          unknown); there is no IRS lookup yet, and anything unclassifiable is counted as dark. Committees registered with the FEC
          whose receipts were not walked (outside the loaded neighborhood, or past the hop or node cap) are a separate
          &quot;not walked&quot; bucket, shown in grey: those dollars are neither disclosed nor dark, and they do not count toward
          the traceability score.
        </p>
      </Card>
      <Card title="Conduits">
        <p className="text-sm">
          Earmarked contributions through ActBlue, WinRed and similar conduits are attributed to the individual who gave them. Memo
          entries are excluded so no dollar is counted twice. The conduit itself is treated as a pipe, not a source.
        </p>
      </Card>
      <Card title="Dossiers">
        <p className="text-sm">
          Incumbents are judged on roll-call votes and sponsored bills. Challengers can only be judged on stated positions. These are
          different kinds of evidence and are labeled as such. Position summaries are written by a person from the linked record, and
          are marked &quot;needs review&quot; until a second person has checked them.
        </p>
      </Card>
    </div>
  );
}

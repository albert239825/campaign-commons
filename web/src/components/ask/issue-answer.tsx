import Link from "next/link";
import { ISSUE_AXES } from "@campaign-commons/contracts";
import { Card, Chip, Money, SourceLink } from "@/components/ui";
import { routes } from "@/lib/format";
import type { SpenderIssueAnswer, SpenderStance } from "@/lib/ask-issues";
import { Caveats } from "./figures";

function directionText(direction: number, issueId: SpenderIssueAnswer["issueId"]): string {
  if (direction === 0) return "takes a position on neither side";
  const strength = Math.abs(direction) === 2 ? "strongly" : "leans";
  const side = direction > 0 ? ISSUE_AXES[issueId].plus : ISSUE_AXES[issueId].minus;
  return `${strength} toward: ${side}`;
}

function StanceRow({ stance, answer, raceId, entityIds }: { stance: SpenderStance; answer: SpenderIssueAnswer; raceId: string; entityIds: ReadonlySet<string> }) {
  const { spender, position } = stance;
  return (
    <li className="space-y-2 border-t border-neutral-100 py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {entityIds.has(spender.spender_id) ? (
            <Link href={routes.entity(raceId, spender.spender_id)} className="font-medium hover:underline">
              {spender.spender_name}
            </Link>
          ) : (
            <span className="font-medium">{spender.spender_name}</span>
          )}
          <span className="text-xs text-neutral-500">{spender.spender_type_label}</span>
        </span>
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <Chip tone={spender.support_oppose === "O" ? "red" : "green"}>{spender.support_oppose === "O" ? "spending against" : "spending for"} {answer.candidate.name}</Chip>
          <Money amount={spender.amount} />
          <SourceLink href={spender.source_url} label="FEC Sched. E" />
        </span>
      </div>
      {position ? (
        <div className="ml-3 space-y-1 border-l-2 border-neutral-200 pl-3 text-sm">
          <p className="text-neutral-700">{directionText(position.direction, answer.issueId)}</p>
          <blockquote className="border-l-2 border-neutral-300 pl-3 text-neutral-700">&ldquo;{position.quote}&rdquo;</blockquote>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
            <SourceLink href={position.source_url} label="position source" />
            {position.basis.basis === "verified" ? (
              <Chip tone="green">verified by hand</Chip>
            ) : (
              <Chip tone="amber" title={position.basis.rule}>model-read · unverified</Chip>
            )}
          </div>
        </div>
      ) : (
        <p className="ml-3 text-xs text-neutral-500">No stated position found on its own site.</p>
      )}
    </li>
  );
}

export function IssueAnswerView({ answer, raceId, entityIds }: { answer: SpenderIssueAnswer; raceId: string; entityIds: ReadonlySet<string> }) {
  return (
    <div className="space-y-6">
      {answer.groups.map((group) => (
        <Card key={group.key} title={<span>{group.label} <span className="font-normal text-neutral-500">({group.rows.length})</span></span>}>
          <ul>{group.rows.map((stance) => <StanceRow key={stance.spender.spender_id} stance={stance} answer={answer} raceId={raceId} entityIds={entityIds} />)}</ul>
        </Card>
      ))}
      <Caveats items={answer.caveats} />
    </div>
  );
}

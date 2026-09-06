import { ISSUES, type IssueId } from "@campaign-commons/contracts";
import { SectionNav } from "@/components/ui/detail-layout";

export function IssueNav({ covered }: { covered: Set<IssueId> }) {
  return <SectionNav label="Explore the issues" items={ISSUES.map(issue => ({ id: issue.id, label: issue.label, note: covered.has(issue.id) ? undefined : "No record" }))} />;
}

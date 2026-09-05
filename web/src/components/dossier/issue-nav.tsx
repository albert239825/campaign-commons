import { ISSUES, type IssueId } from "@citizen-gotham/contracts";

export function IssueNav({ covered }: { covered: Set<IssueId> }) {
  return (
    <nav aria-label="Issues" className="sticky top-6 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Issues</div>
      <ol className="space-y-0.5 border-l border-neutral-200">
        {ISSUES.map((issue) => {
          const has = covered.has(issue.id);
          return (
            <li key={issue.id}>
              <a
                href={`#${issue.id}`}
                className={`-ml-px block border-l-2 border-transparent py-1 pl-3 hover:border-neutral-900 hover:text-neutral-900 ${
                  has ? "text-neutral-700" : "text-neutral-400"
                }`}
              >
                {issue.label}
                {!has && <span className="ml-1 text-[10px] uppercase text-neutral-400">no record</span>}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

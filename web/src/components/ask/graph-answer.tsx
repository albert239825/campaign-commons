// OWNER: Money Trails (D-79).
import Link from "next/link";
import type { ReactNode } from "react";
import { SourceLink, VisibilityBadge } from "@/components/ui";
import { factSentence, GRAPH_OP_LABELS, type AskGraphResponse, type GraphFact, type GraphNodeRef } from "@/lib/graph/facts";

type GraphResult = Extract<AskGraphResponse, { kind: "graph" }>;

const WITHHELD_COPY: Record<Extract<GraphResult["narrative"], { status: "withheld" }>["reason"], string> = {
  empty: "the model returned nothing",
  too_long: "the model's text ran past the length allowed",
  url: "the model's text contained a link",
  bad_citation: "the model cited a record that is not in the list below",
  uncited_number: "the model stated a figure without citing a record",
  unknown_number: "the model stated a figure that is not in any record below",
};

/**
 * The graph-mode answer: every fact is one edge read from the graph, rendered with its own deterministic sentence and
 * source link (src/lib/graph/facts.ts). The model-written paragraph, when there is one, sits above them and is labelled
 * as such; it only ever cites the numbered facts. Nothing else on the panel comes from the model.
 */
export function GraphAnswer({ result }: { result: GraphResult }) {
  const paths = result.op === "money_path" ? groupByPath(result.facts) : null;
  return (
    <section className="graph-answer space-y-4" aria-label="Graph answer">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          {GRAPH_OP_LABELS[result.op]} · {result.facts.length} record{result.facts.length === 1 ? "" : "s"} read from the filings graph
        </p>
        <p className="text-sm text-neutral-700">
          {result.subjects.map((s, i) => (
            <span key={s.ids.join("|")}>
              {i > 0 ? " and " : ""}
              <Name node={{ id: s.ids[0], name: s.name, kind: s.kind, href: s.href }} />
            </span>
          ))}
          {result.note ? <span className="text-neutral-500"> — {result.note}</span> : null}
        </p>
      </header>

      {result.narrative.status === "ok" ? (
        <div className="graph-narrative border-l-2 border-neutral-300 pl-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Model-written summary — Grok, from the records below only</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-900">
            <Cited text={result.narrative.text} facts={result.facts} />
          </p>
        </div>
      ) : (
        <p className="graph-narrative-withheld text-xs text-neutral-500">
          {result.narrative.status === "withheld"
            ? `No summary is shown: ${WITHHELD_COPY[result.narrative.reason]}. The records themselves are below.`
            : "No summary is shown: the model was unavailable. The records themselves are below."}
        </p>
      )}

      {result.facts.length === 0 ? (
        <p className="text-sm text-neutral-700">No filed record in this race&apos;s graph connects these names.</p>
      ) : paths ? (
        <ol className="space-y-4">
          {paths.map((hops, i) => (
            <li key={i} className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                Path {i + 1} · {hops.length} hop{hops.length === 1 ? "" : "s"}
              </p>
              <FactList facts={hops} />
            </li>
          ))}
        </ol>
      ) : (
        <FactList facts={result.facts} />
      )}
    </section>
  );
}

function FactList({ facts }: { facts: readonly GraphFact[] }) {
  return (
    <ol className="graph-facts divide-y divide-neutral-200 text-sm">
      {facts.map((f) => (
        <li key={f.n} id={`fact-${f.n}`} className="flex items-baseline gap-3 py-2">
          <span className="w-8 shrink-0 tabular-nums text-xs text-neutral-500">[{f.n}]</span>
          <span className="flex-1 text-neutral-900">{factSentence(f)}</span>
          <span className="flex shrink-0 items-baseline gap-2">
            {f.visibility !== "disclosed" && <VisibilityBadge visibility={f.visibility} />}
            {f.source_url ? <SourceLink href={f.source_url} /> : <span className="text-xs text-neutral-400">no source url</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Name({ node }: { node: GraphNodeRef }) {
  return node.href ? (
    <Link href={node.href} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
      {node.name}
    </Link>
  ) : (
    <span>{node.name}</span>
  );
}

/** The narrative with each [n] turned into a link to fact n below; the text between citations is shown verbatim. */
function Cited({ text, facts }: { text: string; facts: readonly GraphFact[] }) {
  const out: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    out.push(text.slice(last, m.index));
    out.push(
      facts.some((f) => f.n === n) ? (
        <a key={`${m.index}-${n}`} href={`#fact-${n}`} className="text-xs text-neutral-500 hover:text-neutral-900">
          [{n}]
        </a>
      ) : (
        m[0]
      ),
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function groupByPath(facts: readonly GraphFact[]): GraphFact[][] {
  const groups = new Map<number, GraphFact[]>();
  for (const f of facts) {
    const k = f.path ?? 0;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, hops]) => hops);
}

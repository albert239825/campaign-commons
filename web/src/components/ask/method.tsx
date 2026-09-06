/** The receipt under every Money Trails page: how the question was read (owned here) and how the answers were built (from the data). */
export function AskMethod({ dataMethod }: { dataMethod: string }) {
  return (
    <footer className="ask-method border-t pt-4 space-y-2">
      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">How the question is read.</span> A typed question is sent to a language model on the server (Grok, via xAI), which picks
        one of the three supported question types and one candidate or committee from this race&apos;s list, or nothing. It is given only that list and the question; it does
        not search, and nothing it writes is shown. Its pick is accepted only if both values are on the list. If the model is unavailable, over its time budget or picks
        nothing, the browser matches the question by name and keyword instead. Either way the result is a link to a precomputed page; every number and sentence on it comes
        from the filed records described below, not from the model.
      </p>
      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">How the answers were built.</span> {dataMethod}
      </p>
    </footer>
  );
}

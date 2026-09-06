/** The receipt under every Money Trails page: how the question was read (owned here) and how the answers were built (from the data). */
export function AskMethod({ dataMethod }: { dataMethod: string }) {
  return (
    <footer className="ask-method border-t pt-4 space-y-2">
      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">How the question is read.</span> Questions are answered by a language model that writes one read-only query over the filings graph; the site validates and runs it and shows every returned row with its filing source, and the model&apos;s summary is withheld unless every number in it is in those rows. When a precomputed page matches the question it is linked as a related page. Where the graph is not connected, the browser matcher picks a page instead.
      </p>
      <p className="text-xs text-neutral-500">
        On issue pages the groups&apos; stated positions were read from their own sites by a model offline and kept only where the quote appears verbatim on the page; each is labelled verified or unverified.
      </p>
      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">How the answers were built.</span> {dataMethod}
      </p>
    </footer>
  );
}

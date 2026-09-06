import { getSearchIndex } from "@/lib/data";

/** Static route: `next build` writes data/out/search.json into the build output; the search box fetches it once. */
export const dynamic = "force-static";

export function GET() {
  return Response.json(getSearchIndex(), {
    headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
